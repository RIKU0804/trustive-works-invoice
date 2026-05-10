"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { fmtJpy, fmtPercent } from "@/lib/format";

/**
 * 進化版要件3 (260510): 「これもフィルターで出るようにしたい」
 *
 * 邸一覧をクライアントサイドでフィルタする。サーバーラウンドトリップを
 * 発生させず、入力に応じて即座に表示を絞り込む。
 *
 * フィルタ条件:
 *  - 物件名・契約番号の部分一致
 *  - 担当者（班長）
 *  - カテゴリ別の金額レンジ
 *
 * 集計フッター: フィルタ後の合計を表示する。
 */

export interface PropertyFilterRow {
  id: string;
  property_name: string;
  contract_no: string | null;
  staff_name: string | null;
  amount_sales: number;
  amount_shaho: number;
  amount_seisanka: number;
  amount_material: number;
  amount_sales_tax: number;
  amount_shaho_tax: number;
  amount_seisanka_tax: number;
  amount_material_tax: number;
  amount_gross_profit: number;
  gross_profit_rate: number;
}

interface PropertiesFiltersProps {
  rows: PropertyFilterRow[];
  staffOptions: string[];
}

type CategoryKey = "all" | "sales" | "shaho" | "seisanka" | "material" | "negative_profit";

const CATEGORY_OPTIONS: Array<{ value: CategoryKey; label: string }> = [
  { value: "all", label: "全カテゴリ" },
  { value: "sales", label: "売上あり" },
  { value: "shaho", label: "社保あり" },
  { value: "seisanka", label: "精算あり" },
  { value: "material", label: "材料費あり" },
  { value: "negative_profit", label: "赤字のみ" },
];

export function PropertiesFilters({ rows, staffOptions }: PropertiesFiltersProps) {
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<string>("");
  const [category, setCategory] = useState<CategoryKey>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.property_name} ${r.contract_no ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (staff && (r.staff_name ?? "") !== staff) return false;
      if (category === "sales" && r.amount_sales <= 0) return false;
      if (category === "shaho" && r.amount_shaho <= 0) return false;
      if (category === "seisanka" && r.amount_seisanka <= 0) return false;
      if (category === "material" && r.amount_material <= 0) return false;
      if (category === "negative_profit" && r.amount_gross_profit >= 0) return false;
      return true;
    });
  }, [rows, query, staff, category]);

  const totals = useMemo(() => {
    const acc = {
      sales: 0,
      shaho: 0,
      seisanka: 0,
      material: 0,
      sales_tax: 0,
      shaho_tax: 0,
      seisanka_tax: 0,
      material_tax: 0,
      profit: 0,
    };
    for (const r of filtered) {
      acc.sales += r.amount_sales;
      acc.shaho += r.amount_shaho;
      acc.seisanka += r.amount_seisanka;
      acc.material += r.amount_material;
      acc.sales_tax += r.amount_sales_tax;
      acc.shaho_tax += r.amount_shaho_tax;
      acc.seisanka_tax += r.amount_seisanka_tax;
      acc.material_tax += r.amount_material_tax;
      acc.profit += r.amount_gross_profit;
    }
    return acc;
  }, [filtered]);

  const totalGrossRate = totals.sales > 0 ? totals.profit / totals.sales : 0;
  const hasActiveFilter = query || staff || category !== "all";

  function clearAll() {
    setQuery("");
    setStaff("");
    setCategory("all");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="物件名・契約番号で検索"
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="物件名・契約番号で検索"
          />
        </div>

        <select
          value={staff}
          onChange={(e) => setStaff(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="班長で絞り込み"
        >
          <option value="">全班長</option>
          {staffOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryKey)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="カテゴリで絞り込み"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="w-3 h-3" />
            クリア
          </button>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} / {rows.length} 件
        </span>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium whitespace-nowrap">邸名</th>
              <th className="px-4 py-3 text-left font-medium whitespace-nowrap">担当者</th>
              <th className="px-4 py-3 text-right font-medium whitespace-nowrap">①売上 / 税</th>
              <th className="px-4 py-3 text-right font-medium whitespace-nowrap">②社保 / 税</th>
              <th className="px-4 py-3 text-right font-medium whitespace-nowrap">③精算 / 税</th>
              <th className="px-4 py-3 text-right font-medium whitespace-nowrap">④材料 / 税</th>
              <th className="px-4 py-3 text-right font-medium whitespace-nowrap">粗利</th>
              <th className="px-4 py-3 text-right font-medium whitespace-nowrap">粗利率</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30 align-top">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{r.property_name}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {r.staff_name ?? "—"}
                </td>
                <NumPairCell excl={r.amount_sales} tax={r.amount_sales_tax} />
                <NumPairCell excl={r.amount_shaho} tax={r.amount_shaho_tax} />
                <NumPairCell excl={r.amount_seisanka} tax={r.amount_seisanka_tax} />
                <NumPairCell excl={r.amount_material} tax={r.amount_material_tax} />
                <td className={`px-4 py-3 text-right tabular-nums font-medium ${r.amount_gross_profit < 0 ? "text-red-600" : ""}`}>
                  {fmtJpy(r.amount_gross_profit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtPercent(r.gross_profit_rate)}
                </td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="bg-muted/30 border-t-2">
              <tr className="font-semibold align-top">
                <td className="px-4 py-3" colSpan={2}>
                  合計（{filtered.length}件）
                </td>
                <NumPairCell excl={totals.sales} tax={totals.sales_tax} bold />
                <NumPairCell excl={totals.shaho} tax={totals.shaho_tax} bold />
                <NumPairCell excl={totals.seisanka} tax={totals.seisanka_tax} bold />
                <NumPairCell excl={totals.material} tax={totals.material_tax} bold />
                <td className={`px-4 py-3 text-right tabular-nums ${totals.profit < 0 ? "text-red-600" : ""}`}>
                  {fmtJpy(totals.profit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtPercent(totalGrossRate)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function NumPairCell({ excl, tax, bold }: { excl: number; tax: number; bold?: boolean }) {
  return (
    <td className={`px-4 py-3 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
      <div>{fmtJpy(excl)}</div>
      <div className="text-xs text-muted-foreground">(税 {fmtJpy(tax)})</div>
    </td>
  );
}
