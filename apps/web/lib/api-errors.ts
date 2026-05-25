/**
 * クライアント向けエラー応答のサニタイズ (MEDIUM M2)
 *
 * Supabase / 外部 API のエラーメッセージをそのままクライアントに投げると
 * スキーマや内部実装が漏れる。サーバ側には詳細を残しつつクライアントには
 * ユーザ向けの日本語メッセージのみを返すためのヘルパ群。
 */
import { logger } from "@/lib/logger";

/**
 * 内部メッセージはサーバログに残し、クライアントには汎用の日本語メッセージを
 * 含む Error を返す。
 *
 * @param internalMessage サーバ側で記録する詳細（DB エラー文など）
 * @param fallback クライアントに見せるユーザ向けメッセージ
 */
export function userFacingError(
  internalMessage: string,
  fallback: string
): Error {
  logger.error("action_error", { internalMessage });
  return new Error(fallback);
}
