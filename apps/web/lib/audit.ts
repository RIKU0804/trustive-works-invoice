import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";

export type AuditSupabaseClient = SupabaseClient<Database>;

export interface AuditResource {
  type: string;
  id: string;
}

/**
 * 監査ログを書き込みます。
 *
 * 失敗してもメイン処理は止めず、warnログのみ出力します。
 * ログ書き込みエラーはAPIレスポンスに影響を与えません。
 */
export async function logAction(
  supabase: AuditSupabaseClient,
  orgId: string,
  userId: string,
  action: string,
  resource?: AuditResource,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_logs").insert({
      organization_id: orgId,
      user_id: userId,
      action,
      resource_type: resource?.type ?? null,
      resource_id: resource?.id ?? null,
      metadata: (metadata ?? null) as Database["public"]["Tables"]["audit_logs"]["Insert"]["metadata"],
    });

    if (error) {
      console.warn("[audit] failed to write audit log:", {
        action,
        resource,
        message: error.message,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn("[audit] unexpected error while writing audit log:", {
      action,
      resource,
      message,
    });
  }
}
