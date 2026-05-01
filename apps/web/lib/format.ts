/**
 * 共通フォーマット関数
 *
 * 通貨・パーセント表記の統一のため、全画面で必ずこのモジュールを使うこと。
 * 重複定義 (fmtJpy / formatCurrency など) は廃止。
 */

/**
 * 日本円表記
 *  - null / undefined → "—"
 *  - それ以外         → "¥123,456"
 */
export function fmtJpy(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `¥${Math.round(Number(n)).toLocaleString("ja-JP")}`;
}

/**
 * 数値のみ（記号なし）。テーブル内で記号を別カラムに分けたいとき用。
 */
export function fmtNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Math.round(Number(n)).toLocaleString("ja-JP");
}

/**
 * 粗利率など 0..1 の小数を "12.3%" 形式に。
 *  - null / undefined → "—"
 */
export function fmtPercent(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(Number(rate))) return "—";
  return `${(Number(rate) * 100).toFixed(1)}%`;
}
