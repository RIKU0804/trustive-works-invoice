"use client";

interface RootErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * ルートレベルのエラーバウンダリ。
 * RootLayout 内部で throw された未捕捉エラーを表示し、再試行を提供する。
 */
export default function RootError({ error, reset }: RootErrorProps) {
  return (
    <html lang="ja">
      <body>
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
      </body>
    </html>
  );
}
