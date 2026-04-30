import type { ParseResponse } from "./types";

const API_URL = process.env.PYTHON_API_URL!;
const API_KEY = process.env.PYTHON_API_KEY!;

export async function parsePdf(file: File, organizationId: string): Promise<ParseResponse> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/pdf/parse`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "X-Organization-Id": organizationId,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Python API error: ${res.status}`);
  }

  return res.json();
}
