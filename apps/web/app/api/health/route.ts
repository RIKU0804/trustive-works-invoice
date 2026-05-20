// Lightweight liveness probe used by docker compose healthcheck.
// Intentionally has no auth and does no DB / external calls.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  // 認証なしエンドポイントのため内部情報 (uptime 等) は返さない
  return NextResponse.json({ status: "ok" });
}
