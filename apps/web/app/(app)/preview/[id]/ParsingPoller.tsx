"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 10 * 60_000;

const PHASES: ReadonlyArray<{ label: string; minSeconds: number }> = [
  { label: "PDFを読込中...", minSeconds: 0 },
  { label: "項目を抽出中...", minSeconds: 5 },
  { label: "AI分類中...", minSeconds: 15 },
  { label: "結果を保存中...", minSeconds: 25 },
];

function formatElapsed(seconds: number): string {
  const mm = Math.floor(seconds / 60).toString();
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * 解析中ステータスの自動更新ポーラ。
 * 5秒間隔で router.refresh() を呼び、Server Component を再評価することで
 * parse_status が completed/failed になったタイミングで自動的に UI が切り替わる。
 *
 * 暴走防止: 10分を経過した時点でポーリングを停止しタイムアウト表示に切り替える。
 * 「再試行」ボタンで開始時刻をリセットし再ポーリングを始める。
 */
export function ParsingPoller() {
  const router = useRouter();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const startedAtRef = useRef<number>(Date.now());

  // 経過時間カウンタ
  useEffect(() => {
    const tickId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(tickId);
  }, []);

  // ポーリング: 5秒ごとにサーバーコンポーネント再評価。
  // タイムアウト到達時はクリアしてタイムアウト表示へ遷移する。
  useEffect(() => {
    if (timedOut) return;
    const pollId = window.setInterval(() => {
      if (Date.now() - startedAtRef.current > MAX_POLL_MS) {
        window.clearInterval(pollId);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(pollId);
  }, [router, timedOut]);

  function handleRetry() {
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setTimedOut(false);
  }

  if (timedOut) {
    return (
      <div
        className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="h-5 w-5 mt-0.5 flex-shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <div className="flex-1 space-y-2">
            <p className="font-medium">解析タイムアウト — 管理者に連絡してください</p>
            <p className="text-xs text-amber-800">
              10分以上解析が完了していません。バックエンドで処理が止まっている可能性があります。
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800"
            >
              再試行
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentPhase =
    [...PHASES].reverse().find((p) => elapsedSeconds >= p.minSeconds) ?? PHASES[0];

  return (
    <div
      className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-blue-700" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-medium">{currentPhase.label}</p>
          <p className="mt-0.5 text-xs text-blue-700">
            {formatElapsed(elapsedSeconds)} 経過 ／ 完了すると自動的に表示が切り替わります
          </p>
        </div>
      </div>
    </div>
  );
}
