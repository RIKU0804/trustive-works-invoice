import { Loader2 } from "lucide-react";

/**
 * (app) グループ共通のローディングスケルトン。
 * Server Component のサスペンド時に表示される。
 */
export default function AppLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>読み込み中...</span>
      </div>
      <div className="h-8 w-1/3 animate-pulse rounded bg-gray-200" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
      </div>
    </div>
  );
}
