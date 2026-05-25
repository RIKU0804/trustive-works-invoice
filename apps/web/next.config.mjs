/** @type {import('next').NextConfig} */

// Server Actions の CSRF オリジン許可リスト。
// 本番ドメインを env (NEXT_PUBLIC_SITE_URL / SITE_URL) から導出し、
// localhost 固定 (本番でオリジン不一致になる) を解消する。
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "";
const siteHost = (() => {
  try {
    return siteUrl ? new URL(siteUrl).host : "";
  } catch {
    return "";
  }
})();

// HIGH H4: localhost を本番でも許可していたため、dev 環境のみ追加する。
const isDev = process.env.NODE_ENV !== "production";
const allowedOrigins = [
  ...(isDev ? ["localhost:3000", "127.0.0.1:3000"] : []),
  ...(siteHost ? [siteHost] : []),
];

// Supabase Storage や API へのアクセスを許可するため、Supabase URL の origin を
// connect-src と img-src に追加する。
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).origin : "";
  } catch {
    return "";
  }
})();

const connectSrc = ["'self'", supabaseOrigin, ...(isDev ? ["ws:", "wss:"] : [])]
  .filter(Boolean)
  .join(" ");
const imgSrc = ["'self'", "data:", supabaseOrigin].filter(Boolean).join(" ");

// HIGH H4: 既定の CSP。Next.js 14 は inline script (runtime/hydration) を
// 残すため style-src は 'unsafe-inline' を許容するが、本番では nonce ベースへ
// 切り替えるのが望ましい。最低限の境界として frame-ancestors / base-uri /
// form-action を 'none' / 'self' に絞る。
const cspHeader = [
  `default-src 'self'`,
  // Next.js dev は eval を使うが本番では使わない。'unsafe-inline' は
  // Next.js の hydration script 用に許容（次のステップで nonce 化を検討）。
  isDev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
    : `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src ${imgSrc}`,
  `font-src 'self' data:`,
  `connect-src ${connectSrc}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
].join("; ");

const nextConfig = {
  // Required for Docker production deploys: emits a self-contained
  // .next/standalone/ directory with a minimal node_modules.
  output: "standalone",
  experimental: {
    serverActions: { allowedOrigins },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
