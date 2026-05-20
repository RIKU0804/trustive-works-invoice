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

const allowedOrigins = [
  "localhost:3000",
  "127.0.0.1:3000",
  ...(siteHost ? [siteHost] : []),
];

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
