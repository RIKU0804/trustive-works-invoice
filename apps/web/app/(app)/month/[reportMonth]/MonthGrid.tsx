"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { assignStaff } from "@/app/actions/staff";

export interface PropertyRow {
  id: string;
  propertyName: string;
  workSummary: string | null;
  amountSales: number;
  amountShaho: number;
  amountSeisanka: number;
  amountMaterial: number;
  amountGrossProfit: number;
  grossProfitRate: number;
  staffMemberId: string | null;
  staffName: string;
}

export interface StaffOption {
  id: string;
  name: string;
}

interface Totals {
  sales: number;
  shaho: number;
  seisanka: number;
  material: number;
  grossProfit: number;
  grossProfitRate: number;
}

type SortKey =
  | "propertyName"
  | "workSummary"
  | "amountSales"
  | "amountShaho"
  | "amountSeisanka"
  | "amountMaterial"
  | "amountGrossProfit"
  | "staffName"
  | "grossProfitRate";

const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75];
const DEFAULT_ZOOM = 1.0;
const ZOOM_STORAGE_KEY = "invoice-saas2:month-zoom";

function fmtJpy(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function rateColor(rate: number): string {
  if (rate >= 0.4) return "text-green-700 font-semibold";
  if (rate >= 0.3) return "text-blue-700";
  if (rate >= 0.2) return "text-gray-700";
  return "text-red-700";
}

export function MonthGrid({
  rows,
  totals,
  staffOptions,
}: {
  rows: PropertyRow[];
  totals: Totals;
  staffOptions: StaffOption[];
}) {
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  const [optimisticRows, updateRows] = useOptimistic(
    rows,
    (state, p: { id: string; staffMemberId: string | null; staffName: string }) =>
      state.map((r) =>
        r.id === p.id
          ? { ...r, staffMemberId: p.staffMemberId, staffName: p.staffName }
          : r
      )
  );

  function handleStaffChange(propertyId: string, value: string) {
    const opt = staffOptions.find((s) => s.id === value) ?? null;
    const property = optimisticRows.find((r) => r.id === propertyId);
    const propertyName = property?.propertyName ?? "物件";
    startTransition(async () => {
      updateRows({
        id: propertyId,
        staffMemberId: value || null,
        staffName: opt?.name ?? "",
      });
      try {
        await assignStaff(propertyId, value || null);
        toast.success(
          opt
            ? `${propertyName} を ${opt.name} に割当しました`
            : `${propertyName} の担当者を解除しました`
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "割当に失敗しました"
        );
      }
    });
  }

  // 物件名検索
  const [searchQuery, setSearchQuery] = useState("");

  // ズーム永続化
  useEffect(() => {
    const saved = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (saved) {
      const v = parseFloat(saved);
      if (ZOOM_LEVELS.includes(v)) setZoom(v);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
  }, [zoom]);

  // Ctrl+wheel ズーム
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((current) => {
        const idx = ZOOM_LEVELS.indexOf(current);
        const next = e.deltaY < 0 ? idx + 1 : idx - 1;
        return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, next))];
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return optimisticRows;
    const q = searchQuery.toLowerCase();
    return optimisticRows.filter((r) =>
      [r.propertyName, r.workSummary ?? "", r.staffName]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [optimisticRows, searchQuery]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const sorted = [...filteredRows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv), "ja");
    });
    return sortAsc ? sorted : sorted.reverse();
  }, [filteredRows, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  // キーボードナビ
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!activeCell) return;
    const { row, col } = activeCell;
    let nr = row;
    let nc = col;
    if (e.key === "ArrowDown") nr = Math.min(sortedRows.length - 1, row + 1);
    else if (e.key === "ArrowUp") nr = Math.max(0, row - 1);
    else if (e.key === "ArrowRight") nc = Math.min(8, col + 1);
    else if (e.key === "ArrowLeft") nc = Math.max(0, col - 1);
    else return;
    e.preventDefault();
    setActiveCell({ row: nr, col: nc });
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div className="space-y-2">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center justify-between bg-gray-100 border rounded-md px-3 py-2 text-xs gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 物件名・工事・担当者で検索..."
            className="rounded border px-2 py-1 bg-white w-64"
          />
          <span className="text-muted-foreground">
            {sortedRows.length === rows.length
              ? `${rows.length} 邸`
              : `${sortedRows.length}/${rows.length} 邸`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setZoom((z) => ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)])
            }
            disabled={zoom === ZOOM_LEVELS[0]}
            className="rounded border px-2 py-1 hover:bg-white disabled:opacity-40"
            aria-label="縮小"
          >
            −
          </button>
          <select
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="rounded border px-2 py-1 bg-white"
          >
            {ZOOM_LEVELS.map((z) => (
              <option key={z} value={z}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              setZoom((z) => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)])
            }
            disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            className="rounded border px-2 py-1 hover:bg-white disabled:opacity-40"
            aria-label="拡大"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom(DEFAULT_ZOOM)}
            className="rounded border px-2 py-1 hover:bg-white"
          >
            100%
          </button>
        </div>
      </div>

      {/* 表 */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="rounded-lg border bg-white overflow-auto focus:outline-none focus:ring-2 focus:ring-primary/30"
        style={{ maxHeight: "70vh" }}
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            width: `${100 / zoom}%`,
          }}
        >
          <table className="text-xs whitespace-nowrap border-collapse" style={{ minWidth: 1200 }}>
            <thead className="sticky top-0 z-20">
              <HeaderCell
                onClick={() => toggleSort("propertyName")}
                indicator={sortIndicator("propertyName")}
                sticky
                left={0}
                width={40}
                align="center"
              >
                No
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("propertyName")}
                indicator={sortIndicator("propertyName")}
                sticky
                left={40}
                width={130}
              >
                顧客名
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("workSummary")}
                indicator={sortIndicator("workSummary")}
                width={140}
              >
                工事名称
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("amountSales")}
                indicator={sortIndicator("amountSales")}
                align="right"
                width={120}
              >
                ①税抜
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("amountShaho")}
                indicator={sortIndicator("amountShaho")}
                align="right"
                width={120}
              >
                ②社保
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("amountSeisanka")}
                indicator={sortIndicator("amountSeisanka")}
                align="right"
                width={120}
              >
                ③生産課
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("amountMaterial")}
                indicator={sortIndicator("amountMaterial")}
                align="right"
                width={120}
              >
                ④材料費
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("amountGrossProfit")}
                indicator={sortIndicator("amountGrossProfit")}
                align="right"
                width={130}
              >
                ⑦粗利
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("staffName")}
                indicator={sortIndicator("staffName")}
                align="center"
                width={80}
              >
                班長
              </HeaderCell>
              <HeaderCell
                onClick={() => toggleSort("grossProfitRate")}
                indicator={sortIndicator("grossProfitRate")}
                align="right"
                width={90}
              >
                粗利率
              </HeaderCell>
            </thead>
            <tbody>
              {sortedRows.map((p, idx) => (
                <tr
                  key={p.id}
                  className={`border-b ${
                    activeCell?.row === idx ? "bg-blue-50" : "hover:bg-amber-50/40"
                  }`}
                >
                  <BodyCell active={isActive(activeCell, idx, 0)} sticky left={0} width={40} align="center" onClick={() => setActiveCell({ row: idx, col: 0 })}>
                    <span className="text-muted-foreground">{idx + 1}</span>
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 1)} sticky left={40} width={130} onClick={() => setActiveCell({ row: idx, col: 1 })}>
                    <span className="font-medium">{p.propertyName}</span>
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 2)} width={140} onClick={() => setActiveCell({ row: idx, col: 2 })}>
                    <span className="text-muted-foreground">{p.workSummary ?? "—"}</span>
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 3)} width={120} align="right" onClick={() => setActiveCell({ row: idx, col: 3 })}>
                    {fmtJpy(p.amountSales)}
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 4)} width={120} align="right" onClick={() => setActiveCell({ row: idx, col: 4 })}>
                    {fmtJpy(p.amountShaho)}
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 5)} width={120} align="right" onClick={() => setActiveCell({ row: idx, col: 5 })}>
                    {fmtJpy(p.amountSeisanka)}
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 6)} width={120} align="right" onClick={() => setActiveCell({ row: idx, col: 6 })}>
                    {fmtJpy(p.amountMaterial)}
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 7)} width={130} align="right" onClick={() => setActiveCell({ row: idx, col: 7 })}>
                    <span className="font-semibold">{fmtJpy(p.amountGrossProfit)}</span>
                  </BodyCell>
                  <BodyCell
                    active={isActive(activeCell, idx, 8)}
                    width={90}
                    align="center"
                    onClick={() => setActiveCell({ row: idx, col: 8 })}
                  >
                    <select
                      value={p.staffMemberId ?? ""}
                      onChange={(e) => handleStaffChange(p.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-transparent border-0 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                    >
                      <option value="">未</option>
                      {staffOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 9)} width={90} align="right" onClick={() => setActiveCell({ row: idx, col: 9 })}>
                    <span className={rateColor(p.grossProfitRate)}>{fmtPercent(p.grossProfitRate)}</span>
                  </BodyCell>
                </tr>
              ))}
              {/* 合計行 */}
              <tr className="bg-amber-100 border-t-2 border-amber-300 font-semibold sticky bottom-0">
                <td className="px-2 py-2 text-center sticky left-0 bg-amber-100" style={{ minWidth: 40 }}></td>
                <td className="px-2 py-2 sticky bg-amber-100" style={{ left: 40, minWidth: 130, position: "sticky" }}>売上合計</td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2 text-right">{fmtJpy(totals.sales)}</td>
                <td className="px-2 py-2 text-right">{fmtJpy(totals.shaho)}</td>
                <td className="px-2 py-2 text-right">{fmtJpy(totals.seisanka)}</td>
                <td className="px-2 py-2 text-right">{fmtJpy(totals.material)}</td>
                <td className="px-2 py-2 text-right">{fmtJpy(totals.grossProfit)}</td>
                <td className="px-2 py-2"></td>
                <td className={`px-2 py-2 text-right ${rateColor(totals.grossProfitRate)}`}>
                  {fmtPercent(totals.grossProfitRate)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        ショートカット: Ctrl + マウスホイール でズーム / 矢印キーでセル移動
      </div>
    </div>
  );
}

function isActive(active: { row: number; col: number } | null, r: number, c: number) {
  return active?.row === r && active?.col === c;
}

function HeaderCell({
  children,
  onClick,
  indicator,
  align = "left",
  sticky,
  left,
  width,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  indicator?: string;
  align?: "left" | "right" | "center";
  sticky?: boolean;
  left?: number;
  width?: number;
}) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const stickyStyle: React.CSSProperties = sticky
    ? {
        position: "sticky",
        left,
        zIndex: 30,
        minWidth: width,
        width,
      }
    : { minWidth: width, width };
  return (
    <th
      onClick={onClick}
      style={stickyStyle}
      className={`px-2 py-2 font-semibold bg-amber-50 border-b-2 border-amber-200 cursor-pointer hover:bg-amber-100 select-none ${alignClass}`}
    >
      {children}
      <span className="text-amber-600">{indicator}</span>
    </th>
  );
}

function BodyCell({
  children,
  active,
  align = "left",
  sticky,
  left,
  width,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  align?: "left" | "right" | "center";
  sticky?: boolean;
  left?: number;
  width?: number;
  onClick?: () => void;
}) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const stickyStyle: React.CSSProperties = sticky
    ? {
        position: "sticky",
        left,
        zIndex: 10,
        minWidth: width,
        width,
        background: active ? "rgb(219, 234, 254)" : "white",
      }
    : { minWidth: width, width };
  return (
    <td
      onClick={onClick}
      style={stickyStyle}
      className={`px-2 py-1.5 ${alignClass} cursor-cell ${
        active ? "ring-2 ring-blue-500 ring-inset" : ""
      }`}
    >
      {children}
    </td>
  );
}
