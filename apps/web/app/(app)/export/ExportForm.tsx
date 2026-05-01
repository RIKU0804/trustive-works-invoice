"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ExportFormProps {
  months: string[];
}

type ExportFormat = "xlsx" | "csv";

interface PendingDownload {
  month: string;
  format: ExportFormat;
}

const FORMAT_LABEL: Record<ExportFormat, string> = {
  xlsx: "Excel",
  csv: "CSV",
};

/**
 * Content-Disposition から filename / filename* を抽出する。
 * RFC 5987 の `filename*=UTF-8''<percent-encoded>` を優先し、
 * フォールバックとして `filename="..."` を使用する。
 */
function extractFilename(disposition: string | null): string | null {
  if (!disposition) return null;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // フォールバックへ
    }
  }

  const asciiMatch = disposition.match(/filename="?([^"]+?)"?(?:;|$)/i);
  if (asciiMatch?.[1]) return asciiMatch[1].trim();

  return null;
}

function fallbackFilename(month: string, format: ExportFormat): string {
  return `export_${month}.${format}`;
}

async function downloadFile(month: string, format: ExportFormat): Promise<void> {
  const response = await fetch(
    `/api/export?month=${encodeURIComponent(month)}&format=${format}`,
    { method: "GET" }
  );

  if (!response.ok) {
    let serverMessage: string | null = null;
    try {
      const data: unknown = await response.json();
      if (
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string"
      ) {
        serverMessage = (data as { error: string }).error;
      }
    } catch {
      // JSONでなければ無視（バイナリエラーなど）
    }
    throw new Error(serverMessage ?? `ダウンロードに失敗しました (${response.status})`);
  }

  const blob = await response.blob();
  const filename =
    extractFilename(response.headers.get("Content-Disposition")) ??
    fallbackFilename(month, format);

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // 次フレームで revoke してダウンロードの取りこぼしを防ぐ
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function ExportForm({ months }: ExportFormProps) {
  const [pending, setPending] = useState<PendingDownload | null>(null);

  async function handleDownload(month: string, format: ExportFormat): Promise<void> {
    if (pending) return;
    setPending({ month, format });
    try {
      await downloadFile(month, format);
      toast.success(`${FORMAT_LABEL[format]}ファイルをダウンロードしました`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "ダウンロードに失敗しました";
      toast.error(message);
    } finally {
      setPending(null);
    }
  }

  if (months.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">出力可能なデータがありません</p>
        <p className="text-xs text-muted-foreground mt-1">
          PDFをアップロードして解析を完了してください
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">対象月</th>
            <th className="px-4 py-3 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {months.map((month) => {
            const isXlsxPending =
              pending?.month === month && pending.format === "xlsx";
            const isCsvPending =
              pending?.month === month && pending.format === "csv";
            const anyPending = pending !== null;
            return (
              <tr key={month} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  {month.replace(/^(\d{4})-(\d{2})$/, "$1年$2月")}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      onClick={() => handleDownload(month, "xlsx")}
                      disabled={anyPending}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isXlsxPending && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      )}
                      <span>{isXlsxPending ? "生成中..." : "Excelダウンロード"}</span>
                    </button>
                    <button
                      onClick={() => handleDownload(month, "csv")}
                      disabled={anyPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isCsvPending && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      )}
                      <span>{isCsvPending ? "生成中..." : "CSVダウンロード"}</span>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
