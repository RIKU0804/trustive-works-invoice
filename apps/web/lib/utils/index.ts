import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// MEDIUM M3: `new Date(month)` は ISO 文字列を UTC で解釈し、JST のローカル
// 日付に変換する際にずれる (例: '2026-01-01' → JST 06:00 of 2025-12-31)。
// 'YYYY-MM' / 'YYYY-MM-DD' を直接 split して年・月を取り出す。
export function formatReportMonth(month: string): string {
  if (typeof month !== "string") return "";
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  const monthNum = parseInt(m, 10);
  if (!y.match(/^\d{4}$/) || !Number.isFinite(monthNum)) return month;
  return `${y}年${monthNum}月`;
}

// 通貨・パーセント表記は @/lib/format に集約。
// 既存コードからの import 互換用に re-export。
export { fmtJpy, fmtPercent, fmtNumber } from "@/lib/format";
