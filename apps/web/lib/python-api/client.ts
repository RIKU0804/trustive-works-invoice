import { env } from "@/lib/env";
import type { ParseResponse } from "./types";

const API_URL = env.PYTHON_API_URL;
const API_KEY = env.PYTHON_API_KEY;

// PDF 解析 + AI 分類は時間がかかりうるが、ハングした上流で Server Action /
// Node ソケットが無限に占有されるのを防ぐため上限を設ける。
//
// 補足: Vercel Hobby は 60s、Pro は 300s の Function timeout 上限がある。
// 上流の Python API が極端に遅い時にも Function 上限内で諦められるよう
// 120s を採用する (Hobby では実質 60s が上限になるが、明示的にタイムアウトする)。
const REQUEST_TIMEOUT_MS = 120_000;
// 上流が暴走して巨大ボディを返した場合のメモリ保護 (32MB)
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export async function parsePdf(file: File, organizationId: string): Promise<ParseResponse> {
  const form = new FormData();
  form.append("file", file);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/pdf/parse`, {
      method: "POST",
      headers: {
        "X-API-Key": API_KEY,
        "X-Organization-Id": organizationId,
      },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(
        `解析サーバの応答がタイムアウトしました (上限 ${REQUEST_TIMEOUT_MS / 1000}秒)`
      );
    }
    throw new Error("解析サーバに接続できませんでした");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Python API error: ${res.status}`);
  }

  // 上流が JSON 以外 / 異常に巨大なボディを返した場合の保護
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("解析サーバから不正な応答を受信しました");
  }
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("解析サーバの応答が大きすぎます");
  }

  return res.json();
}
