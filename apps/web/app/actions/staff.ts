"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/lib/audit";

export async function addStaffMember(formData: FormData) {
  const supabase = createClient();
  const name = formData.get("name") as string;

  if (!name?.trim()) throw new Error("名前を入力してください");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .single();

  if (membershipError || !membership) throw new Error("組織が見つかりません");
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new Error("この操作を行う権限がありません");
  }

  const orgId = membership.organization_id;

  const { data: max } = await supabase
    .from("staff_members")
    .select("display_order")
    .eq("organization_id", orgId)
    .order("display_order", { ascending: false })
    .limit(1)
    .single();

  const displayOrder = (max?.display_order ?? 0) + 1;
  const trimmedName = name.trim();

  const { data: inserted, error } = await supabase
    .from("staff_members")
    .insert({
      organization_id: orgId,
      name: trimmedName,
      display_order: displayOrder,
    })
    .select("id")
    .single();

  if (error) throw new Error(`追加に失敗しました: ${error.message}`);

  if (inserted) {
    await logAction(
      supabase,
      orgId,
      user.id,
      "staff_member.create",
      { type: "staff_member", id: inserted.id },
      { name: trimmedName, display_order: displayOrder }
    );
  }

  revalidatePath("/settings/staff");
}

export async function assignStaff(propertyId: string, staffMemberId: string | null) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // 変更前のpropertyを取得（before/after記録のため）
  const { data: previous, error: prevError } = await supabase
    .from("properties")
    .select("id, organization_id, staff_member_id")
    .eq("id", propertyId)
    .single();

  if (prevError || !previous) {
    throw new Error("対象の物件が見つかりません");
  }

  // 担当者IDも同じ組織に所属することを確認（クロスオーグ攻撃対策）
  if (staffMemberId) {
    const { data: staffCheck } = await supabase
      .from("staff_members")
      .select("organization_id")
      .eq("id", staffMemberId)
      .single();
    if (!staffCheck || staffCheck.organization_id !== previous.organization_id) {
      throw new Error("無効な担当者IDです");
    }
  }

  const { error } = await supabase
    .from("properties")
    .update({ staff_member_id: staffMemberId })
    .eq("id", propertyId);

  if (error) {
    console.error("[assignStaff] update failed:", error.message);
    throw new Error("担当者の割り当てに失敗しました");
  }

  await logAction(
    supabase,
    previous.organization_id,
    user.id,
    "property.assign",
    { type: "property", id: propertyId },
    {
      before: { staff_member_id: previous.staff_member_id },
      after: { staff_member_id: staffMemberId },
    }
  );

  revalidatePath("/assign/[paymentNoticeId]", "page");
}
