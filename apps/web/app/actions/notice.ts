"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth/membership";
import { logAction } from "@/lib/audit";
import { userFacingError } from "@/lib/api-errors";
import { logger } from "@/lib/logger";

/**
 * payment_notices を削除する。
 *
 * 動作:
 *  1. 呼び出し元が owner/admin であることを確認 (削除は service client 経由で
 *     RLS をバイパスするため、RLS の「admin のみ削除可」を明示的に再現する)
 *  2. 同一 org のものか検証（クロスオーグ攻撃対策）
 *  3. Storage 上の PDF を削除
 *  4. payment_notices を削除（properties / property_lines は ON DELETE CASCADE）
 *  5. 監査ログを残す
 *  6. /dashboard へリダイレクト
 *
 * 注意:
 *  - 本関数は server action として呼ばれる前提。
 *  - 例外メッセージはユーザー向けに整形済み。
 */
export async function deletePaymentNotice(noticeId: string): Promise<void> {
  if (!noticeId) throw new Error("通知書IDが指定されていません");

  const { user, membership } = await requireOrgAdmin();
  const serviceClient = createServiceClient();

  const orgId = membership.organization_id;

  // 対象通知書の組織所属確認（service_role で取得し org をクロスチェック）
  const { data: notice, error: fetchError } = await serviceClient
    .from("payment_notices")
    .select("id, organization_id, file_name, storage_path")
    .eq("id", noticeId)
    .single();

  if (fetchError || !notice) {
    throw new Error("対象の通知書が見つかりません");
  }

  if (notice.organization_id !== orgId) {
    throw new Error("この通知書を削除する権限がありません");
  }

  // Storage の PDF を先に削除（失敗しても DB 側は続行する）
  if (notice.storage_path) {
    const { error: storageError } = await serviceClient.storage
      .from("payment-notices")
      .remove([notice.storage_path]);
    if (storageError) {
      // 致命的ではない。Storage に残骸が残るが DB は消す。
      logger.warn("payment_notice_storage_remove_failed", {
        notice_id: notice.id,
        reason: storageError.message,
      });
    }
  }

  // properties / property_lines は ON DELETE CASCADE 前提
  // HIGH H3: service_role で削除するので organization_id を必ず併用する。
  const { error: deleteError } = await serviceClient
    .from("payment_notices")
    .delete()
    .eq("id", notice.id)
    .eq("organization_id", orgId);

  if (deleteError) {
    throw userFacingError(deleteError.message, "削除に失敗しました");
  }

  await logAction(
    serviceClient,
    orgId,
    user.id,
    "payment_notice.delete",
    { type: "payment_notice", id: notice.id },
    {
      file_name: notice.file_name,
      storage_path: notice.storage_path,
    }
  );

  redirect("/dashboard");
}
