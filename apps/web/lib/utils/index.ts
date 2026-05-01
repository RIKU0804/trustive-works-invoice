import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatReportMonth(month: string): string {
  const d = new Date(month);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

// 通貨・パーセント表記は @/lib/format に集約。
// 既存コードからの import 互換用に re-export。
export { fmtJpy, fmtPercent, fmtNumber } from "@/lib/format";
