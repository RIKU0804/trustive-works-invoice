import {
  createClient as supabaseCreateClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function getEnv() {
  return {
    SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331",
    SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BASE_URL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    TEST_USER_EMAIL:
      process.env.E2E_TEST_EMAIL ?? "e2e-tester@example.com",
    TEST_USER_PASSWORD:
      process.env.E2E_TEST_PASSWORD ?? "Playwright!E2E_4242",
  };
}

export const TEST_ORG_ID = "a1b2c3d4-0000-0000-0000-000000000001";

/**
 * @supabase/ssr のクッキー名は `sb-<host>-auth-token`。
 * createBrowserClient のデフォルト storageKey は
 *   `sb-${baseUrl.hostname.split(".")[0]}-auth-token`
 * となる。ローカル Supabase では hostname=`127.0.0.1` なので
 * 結果として "sb-127-auth-token"。
 */
function deriveCookieName(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname;
  return `sb-${host.split(".")[0]}-auth-token`;
}

/**
 * Supabase admin (service_role) でテストユーザーを作成し、
 * パスワード認証でセッションを取得して storageState 用の cookie を書き出す。
 *
 * Google OAuth はテスト不可なので、シンプルに password 認証バイパスを採用。
 * 実 DB を破壊しないよう、テストユーザーは E2E 専用の固定メールで作成する。
 */
export async function ensureAuthenticatedStorageState(
  storagePath: string
): Promise<void> {
  const env = getEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です。.env.local を確認してください。");
  }
  if (!env.SUPABASE_ANON_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。");
  }

  const admin: SupabaseClient = supabaseCreateClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  // 1. テストユーザーを冪等に作成（既存なら何もしない）
  const userId = await ensureTestUser(admin, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD);

  // 2. 同 organization の membership を冪等に紐付け
  await ensureMembership(admin, userId);

  // 3. anon client で password sign-in
  const anon: SupabaseClient = supabaseCreateClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signInData, error: signInError } =
    await anon.auth.signInWithPassword({
      email: env.TEST_USER_EMAIL,
      password: env.TEST_USER_PASSWORD,
    });

  if (signInError || !signInData?.session) {
    throw new Error(`サインインに失敗: ${signInError?.message ?? "no session"}`);
  }

  // 4. クッキーを Playwright の storageState 形式へ変換
  await mkdir(dirname(storagePath), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();

  const cookieName = deriveCookieName(env.SUPABASE_URL);
  const cookieValue = sessionToCookieValue(signInData.session);
  const baseUrlObj = new URL(env.BASE_URL);

  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: baseUrlObj.hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
      // 1 日後に expire（テスト用なので十分）
      expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
  ]);

  await context.storageState({ path: storagePath });
  await browser.close();
}

/**
 * @supabase/ssr のブラウザストレージは値を `base64-${base64url(JSON)}`
 * 形式で書き込む。サーバー側は同じ形式で読む。
 */
function sessionToCookieValue(session: Session): string {
  // GoTrue のローカルストレージ JSON は currentSession + expiresAt を持つ
  // が、@supabase/ssr が読むときには Session 全体をそのまま JSON.parse するだけで OK。
  // 実際には GoTrueClient.setItem("supabase.auth.token", ...) と同じ形式が必要。
  // テストで重要なのは middleware.ts の supabase.auth.getUser() が成功すること。
  // GoTrue の現行実装は setSession 経由で書き込むときに以下の形を使う:
  //   { access_token, refresh_token, expires_at, expires_in, token_type, user }
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user,
  };
  const json = JSON.stringify(payload);
  return "base64-" + base64UrlEncode(json);
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function ensureTestUser(
  admin: SupabaseClient,
  email: string,
  password: string
): Promise<string> {
  // 既存ユーザー検索（list は最大100件で十分）
  const { data: existing } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const found = existing?.users.find((u) => u.email === email);
  if (found) {
    // パスワードを E2E 用に上書き（既存環境でも実行可能にするため）
    await admin.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
    });
    return found.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data?.user) {
    throw new Error(`テストユーザー作成に失敗: ${error?.message}`);
  }
  return data.user.id;
}

async function ensureMembership(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: rows } = await admin
    .from("memberships")
    .select("user_id")
    .eq("user_id", userId)
    .eq("organization_id", TEST_ORG_ID);

  if (rows && rows.length > 0) return;

  const { error } = await admin.from("memberships").insert({
    user_id: userId,
    organization_id: TEST_ORG_ID,
    role: "owner",
  });

  if (error) {
    throw new Error(`membership 作成に失敗: ${error.message}`);
  }
}
