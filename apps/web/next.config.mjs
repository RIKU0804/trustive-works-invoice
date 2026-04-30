/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Docker production deploys: emits a self-contained
  // .next/standalone/ directory with a minimal node_modules.
  output: "standalone",
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000", "127.0.0.1:3000"] },
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
