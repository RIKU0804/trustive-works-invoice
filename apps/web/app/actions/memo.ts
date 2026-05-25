"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCallerContext } from "@/lib/auth/membership";
import { userFacingError } from "@/lib/api-errors";

// HIGH: formData の as string キャストを排除し、Zod で明示検証する。
const memoSchema = z.object({
  reportMonth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "有効な月を指定してください"),
  content: z.string().max(10_000, "メモが長すぎます").default(""),
});

export async function upsertMemo(formData: FormData) {
  const parsed = memoSchema.safeParse({
    reportMonth: formData.get("reportMonth"),
    content: formData.get("content") ?? "",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "入力が不正です");
  }
  const { reportMonth, content } = parsed.data;

  // 組織IDはサーバ側でcaller認証情報から解決（IDOR対策: クライアント入力を信頼しない）
  const { supabase, user, membership } = await getCallerContext();

  const { error } = await supabase
    .from("monthly_memos")
    .upsert(
      {
        organization_id: membership.organization_id,
        report_month: reportMonth,
        content,
        updated_by: user.id,
      },
      { onConflict: "organization_id,report_month" }
    );

  if (error) {
    throw userFacingError(error.message, "保存に失敗しました");
  }

  revalidatePath("/memos");
}
