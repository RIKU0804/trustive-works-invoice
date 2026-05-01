"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const POLL_INTERVAL_MS = 5_000;

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
 */
export function ParsingPoller() {
  const router = useRouter();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // 経過時間カウンタ
  useEffect(() => {
    const startedAt = Date.now();
    const tickId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(tickId);
  }, []);

  // ポーリング: 5秒ごとにサーバーコンポーネント再評価
  useEffect(() => {
    const pollId = window.setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(pollId);
  }, [router]);

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
