import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

// ブラウザ向け Supabase クライアント。
// NEXT_PUBLIC_* はビルド時に Next.js が文字列リテラルとして inline するため、
// クライアントコードではあえて process.env を直接参照する (サーバ側の env
// バリデーションを browser bundle に持ち込まない)。
// undefined だと createBrowserClient が早期に分かりやすい例外を投げる。
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured"
    );
  }
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
