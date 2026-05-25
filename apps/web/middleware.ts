import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

// HIGH H1 sec: /api/* を一括 bypass しない。
// 明示的に「未認証で叩いて良いパス」のみ allowlist する。
// 他の /api/* ルートは下記の middleware で認証チェックを通す。
const PUBLIC_API_PATHS: readonly string[] = ["/api/health"];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  const isCallbackRoute = pathname.startsWith("/callback");
  const isPublicApiPath = PUBLIC_API_PATHS.some((p) => pathname === p);

  if (!user && !isAuthRoute && !isCallbackRoute && !isPublicApiPath) {
    // /api/* も含めて 未認証ならログインへ誘導する。
    // API は本来 JSON 401 を返すべきだが、middleware で出すと SSR ページとの
    // 挙動が混在するため、ルートハンドラ側で resolveCaller() による認証チェックも
    // 多層防御として残す。
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
