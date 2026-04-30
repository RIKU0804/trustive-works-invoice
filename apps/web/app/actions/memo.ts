"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function upsertMemo(formData: FormData) {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const reportMonth = formData.get("reportMonth") as string;
  const content = formData.get("content") as string;

  if (!reportMonth || !/^\d{4}-\d{2}-\d{2}$/.test(reportMonth)) {
    throw new Error("有効な月を指定してください");
  }

  // 組織IDはサーバ側でcaller認証情報から解決（IDOR対策: クライアント入力を信頼しない）
  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (membershipError || !membership) {
    throw new Error("組織が見つかりません");
  }

  const { error } = await supabase
    .from("monthly_memos")
    .upsert(
      {
        organization_id: membership.organization_id,
        report_month: reportMonth,
        content: content ?? "",
        updated_by: user.id,
      },
      { onConflict: "organization_id,report_month" }
    );

  if (error) {
    console.error("[upsertMemo] save failed:", error.message);
    throw new Error("保存に失敗しました");
  }

  revalidatePath("/memos");
}
