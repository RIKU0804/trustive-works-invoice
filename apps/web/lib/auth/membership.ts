import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * 呼び出し元 (caller) の認証 + メンバーシップ解決を一元化する。
 *
 * 背景 (クロスレビュー H2):
 *  - 旧コードは至る所で `memberships ... .eq("user_id", user.id).single()`
 *    していた。`.single()` は行が 2 件以上だと例外を投げるため、ユーザが
 *    複数組織に所属した瞬間にアプリ全体 (レイアウト含む) がクラッシュした。
 *  - ここでは決定的に 1 件 (joined_at 昇順の先頭) を採用し、クラッシュを除去する。
 *
 * 制約: 現状は「1 ユーザー = 1 アクティブ組織」を前提とする。複数組織の
 * 切り替え UI が必要になったら、ここにアクティブ組織選択 (cookie / claim)
 * を追加する。呼び出し側はこのモジュール経由でのみ membership を解決すること。
 */

export type CallerRole = "owner" | "admin" | "member";

export interface CallerMembership {
  id: string;
  user_id: string;
  organization_id: string;
  role: CallerRole;
}

export interface CallerContext {
  supabase: ReturnType<typeof createClient>;
  user: User;
  membership: CallerMembership;
}

export type CallerResult =
  | { kind: "ok"; ctx: CallerContext }
  | { kind: "unauthenticated" }
  | { kind: "no-membership" }
  | { kind: "error"; message: string };

/** 非例外版。RSC ページ / レイアウト / route handler 用 (状態を明示的に処理する)。 */
export async function resolveCaller(): Promise<CallerResult> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { kind: "unauthenticated" };

  const { data: rows, error } = await supabase
    .from("memberships")
    .select("id, user_id, organization_id, role")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1);

  if (error) return { kind: "error", message: error.message };

  const m = rows?.[0];
  if (!m) return { kind: "no-membership" };

  return {
    kind: "ok",
    ctx: {
      supabase,
      user,
      membership: {
        id: m.id,
        user_id: m.user_id,
        organization_id: m.organization_id,
        role: m.role as CallerRole,
      },
    },
  };
}

/** 例外版。server action 用。認証/メンバーシップが無ければ送出。 */
export async function getCallerContext(): Promise<CallerContext> {
  const result = await resolveCaller();
  switch (result.kind) {
    case "ok":
      return result.ctx;
    case "unauthenticated":
      throw new Error("認証が必要です");
    case "no-membership":
      throw new Error("組織が見つかりません");
    case "error":
      throw new Error("メンバーシップの取得に失敗しました");
  }
}

/** owner / admin を要求する server action 用。 */
export async function requireOrgAdmin(): Promise<CallerContext> {
  const ctx = await getCallerContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "admin") {
    throw new Error("この操作を行う権限がありません");
  }
  return ctx;
}
