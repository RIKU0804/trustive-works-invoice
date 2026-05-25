"use client";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * (app) ルートグループ用エラーバウンダリ。
 * Sidebar / Header を残しつつ、主要コンテンツ部分でエラーを表示する。
 */
export default function AppError({ error, reset }: AppErrorProps) {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">エラーが発生しました</h1>
      <p className="mt-2 text-sm text-gray-600">
        {error.message || "想定外のエラーです"}
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
      >
        再試行
      </button>
    </div>
  );
}
