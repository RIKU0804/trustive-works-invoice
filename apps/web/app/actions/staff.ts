"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgAdmin, getCallerContext } from "@/lib/auth/membership";
import { logAction } from "@/lib/audit";
import { userFacingError } from "@/lib/api-errors";

const staffNameSchema = z
  .string()
  .trim()
  .min(1, "名前を入力してください")
  .max(80, "名前は80文字までです");

export async function addStaffMember(formData: FormData) {
  // HIGH: as string キャストの排除。
  const nameRaw = formData.get("name");
  const parsed = staffNameSchema.safeParse(
    typeof nameRaw === "string" ? nameRaw : ""
  );
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "入力が不正です");
  }
  const trimmedName = parsed.data;

  const { supabase, user, membership } = await requireOrgAdmin();
  const orgId = membership.organization_id;

  const { data: max } = await supabase
    .from("staff_members")
    .select("display_order")
    .eq("organization_id", orgId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const displayOrder = (max?.display_order ?? 0) + 1;

  const { data: inserted, error } = await supabase
    .from("staff_members")
    .insert({
      organization_id: orgId,
      name: trimmedName,
      display_order: displayOrder,
    })
    .select("id")
    .single();

  if (error) throw userFacingError(error.message, "追加に失敗しました");

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
  const { supabase, user, membership } = await getCallerContext();

  // 変更前のpropertyを取得（before/after記録のため）
  const { data: previous, error: prevError } = await supabase
    .from("properties")
    .select("id, organization_id, staff_member_id")
    .eq("id", propertyId)
    .single();

  if (prevError || !previous) {
    throw new Error("対象の物件が見つかりません");
  }

  // 物件が呼び出し元の組織に属することを明示検証
  // (RLS 任せにせず多層防御。クロスオーグ攻撃対策)
  if (previous.organization_id !== membership.organization_id) {
    throw new Error("この物件を編集する権限がありません");
  }

  // 担当者IDも同じ組織に所属することを確認（クロスオーグ攻撃対策）
  if (staffMemberId) {
    const { data: staffCheck } = await supabase
      .from("staff_members")
      .select("organization_id")
      .eq("id", staffMemberId)
      .maybeSingle();
    if (!staffCheck || staffCheck.organization_id !== previous.organization_id) {
      throw new Error("無効な担当者IDです");
    }
  }

  // HIGH H3: id だけでなく organization_id でもフィルタする (多層防御)。
  const { error } = await supabase
    .from("properties")
    .update({ staff_member_id: staffMemberId })
    .eq("id", propertyId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    throw userFacingError(error.message, "担当者の割り当てに失敗しました");
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
