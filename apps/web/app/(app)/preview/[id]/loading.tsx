import { Loader2 } from "lucide-react";

/**
 * /preview/[id] 専用のローディングスケルトン。
 * PDF メタ取得 + 物件取得 + 明細取得を並行待つので
 * 共通スケルトンより少しリッチに表示する。
 */
export default function PreviewLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>支払通知書を読み込み中...</span>
      </div>

      <div className="space-y-2">
        <div className="h-6 w-1/2 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="h-20 animate-pulse rounded-lg border bg-gray-50" />
        <div className="h-20 animate-pulse rounded-lg border bg-gray-50" />
        <div className="h-20 animate-pulse rounded-lg border bg-gray-50" />
      </div>

      <div className="h-64 animate-pulse rounded-lg border bg-gray-50" />
    </div>
  );
}
