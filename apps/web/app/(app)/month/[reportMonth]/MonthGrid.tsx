"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { HelpCircle, Search } from "lucide-react";
import { assignStaff } from "@/app/actions/staff";
import { fmtNumber, fmtPercent } from "@/lib/format";

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

/**
 * 表示列の数 (No, 顧客名, 工事名称, ①税抜, ②社保, ③生産課, ④材料費, ⑦粗利, 班長, 粗利率)。
 * キーボード移動の右端判定に使う。列を増減した場合はここを更新する。
 */
const COLUMN_COUNT = 10;
const MAX_COL_INDEX = COLUMN_COUNT - 1;

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
  const [showHelp, setShowHelp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
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

  // ヘルプポップオーバーを Esc / 外クリックで閉じる。
  // mousedown ベースの外クリック検出に切り替え（onBlur+setTimeout はモバイル/タッチで不安定）。
  useEffect(() => {
    if (!showHelp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHelp(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setShowHelp(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [showHelp]);

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
    else if (e.key === "ArrowRight") nc = Math.min(MAX_COL_INDEX, col + 1);
    else if (e.key === "ArrowLeft") nc = Math.max(0, col - 1);
    else return;
    e.preventDefault();
    setActiveCell({ row: nr, col: nc });
  }

  return (
    <div className="space-y-2">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center justify-between bg-gray-100 border rounded-md px-3 py-2 text-xs gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="物件名・工事・担当者で検索..."
              aria-label="物件名・工事・担当者で検索"
              className="rounded border pl-7 pr-2 py-1 bg-white w-64"
            />
          </div>
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
            aria-label="ズーム倍率"
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

          {/* ヘルプ（キーボードショートカット） */}
          <div className="relative ml-1" ref={helpRef}>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className="flex items-center justify-center rounded border w-7 h-7 hover:bg-white"
              aria-label="キーボードショートカット"
              aria-expanded={showHelp}
              aria-haspopup="dialog"
              title="キーボードショートカット"
            >
              <HelpCircle className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            </button>
            {showHelp && (
              <div
                role="dialog"
                aria-label="キーボードショートカット"
                className="absolute right-0 top-full mt-2 w-72 rounded-md border bg-white shadow-lg p-3 z-50 text-xs"
              >
                <div className="font-semibold mb-2">キーボードショートカット</div>
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-2">
                    <dt>
                      <kbd className="px-1.5 py-0.5 rounded border bg-gray-50 text-[10px]">Ctrl</kbd>
                      {" + "}
                      <span className="text-muted-foreground">マウスホイール</span>
                    </dt>
                    <dd className="text-muted-foreground">ズーム</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>
                      <kbd className="px-1.5 py-0.5 rounded border bg-gray-50 text-[10px]">↑↓←→</kbd>
                    </dt>
                    <dd className="text-muted-foreground">セル移動</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>
                      <kbd className="px-1.5 py-0.5 rounded border bg-gray-50 text-[10px]">Ctrl</kbd>
                      {" + "}
                      <kbd className="px-1.5 py-0.5 rounded border bg-gray-50 text-[10px]">K</kbd>
                    </dt>
                    <dd className="text-muted-foreground">コマンドパレット</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
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
                sortKey="propertyName"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("propertyName")}
                sticky
                left={0}
                width={40}
                align="center"
              >
                No
              </HeaderCell>
              <HeaderCell
                sortKey="propertyName"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("propertyName")}
                sticky
                left={40}
                width={130}
              >
                顧客名
              </HeaderCell>
              <HeaderCell
                sortKey="workSummary"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("workSummary")}
                width={140}
              >
                工事名称
              </HeaderCell>
              <HeaderCell
                sortKey="amountSales"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("amountSales")}
                align="right"
                width={120}
              >
                ①税抜
              </HeaderCell>
              <HeaderCell
                sortKey="amountShaho"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("amountShaho")}
                align="right"
                width={120}
              >
                ②社保
              </HeaderCell>
              <HeaderCell
                sortKey="amountSeisanka"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("amountSeisanka")}
                align="right"
                width={120}
              >
                ③生産課
              </HeaderCell>
              <HeaderCell
                sortKey="amountMaterial"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("amountMaterial")}
                align="right"
                width={120}
              >
                ④材料費
              </HeaderCell>
              <HeaderCell
                sortKey="amountGrossProfit"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("amountGrossProfit")}
                align="right"
                width={130}
              >
                ⑦粗利
              </HeaderCell>
              <HeaderCell
                sortKey="staffName"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("staffName")}
                align="center"
                width={80}
              >
                班長
              </HeaderCell>
              <HeaderCell
                sortKey="grossProfitRate"
                currentSort={sortKey}
                sortAsc={sortAsc}
                onClick={() => toggleSort("grossProfitRate")}
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
                    {fmtNumber(p.amountSales)}
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 4)} width={120} align="right" onClick={() => setActiveCell({ row: idx, col: 4 })}>
                    {fmtNumber(p.amountShaho)}
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 5)} width={120} align="right" onClick={() => setActiveCell({ row: idx, col: 5 })}>
                    {fmtNumber(p.amountSeisanka)}
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 6)} width={120} align="right" onClick={() => setActiveCell({ row: idx, col: 6 })}>
                    {fmtNumber(p.amountMaterial)}
                  </BodyCell>
                  <BodyCell active={isActive(activeCell, idx, 7)} width={130} align="right" onClick={() => setActiveCell({ row: idx, col: 7 })}>
                    <span className="font-semibold">{fmtNumber(p.amountGrossProfit)}</span>
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
                      aria-label={`${p.propertyName} の班長`}
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
              {/* 合計行（zoomのtransformとsticky bottomが衝突するためsticky解除） */}
              <tr className="bg-amber-100 border-t-2 border-amber-300 font-semibold">
                <td className="px-2 py-2 text-center bg-amber-100" style={{ minWidth: 40, width: 40 }}></td>
                <td className="px-2 py-2 bg-amber-100" style={{ minWidth: 130, width: 130 }}>売上合計</td>
                <td className="px-2 py-2 bg-amber-100" style={{ minWidth: 140, width: 140 }}></td>
                <td className="px-2 py-2 text-right">{fmtNumber(totals.sales)}</td>
                <td className="px-2 py-2 text-right">{fmtNumber(totals.shaho)}</td>
                <td className="px-2 py-2 text-right">{fmtNumber(totals.seisanka)}</td>
                <td className="px-2 py-2 text-right">{fmtNumber(totals.material)}</td>
                <td className="px-2 py-2 text-right">{fmtNumber(totals.grossProfit)}</td>
                <td className="px-2 py-2"></td>
                <td className={`px-2 py-2 text-right ${rateColor(totals.grossProfitRate)}`}>
                  {fmtPercent(totals.grossProfitRate)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function isActive(active: { row: number; col: number } | null, r: number, c: number) {
  return active?.row === r && active?.col === c;
}

interface HeaderCellProps {
  children: React.ReactNode;
  onClick?: () => void;
  sortKey?: SortKey;
  currentSort?: SortKey | null;
  sortAsc?: boolean;
  align?: "left" | "right" | "center";
  sticky?: boolean;
  left?: number;
  width?: number;
}

function HeaderCell({
  children,
  onClick,
  sortKey,
  currentSort,
  sortAsc,
  align = "left",
  sticky,
  left,
  width,
}: HeaderCellProps) {
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

  const isActiveSort = sortKey != null && currentSort === sortKey;
  const ariaSort: "ascending" | "descending" | "none" =
    isActiveSort ? (sortAsc ? "ascending" : "descending") : "none";
  const indicator = isActiveSort ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <th
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      role="columnheader"
      aria-sort={ariaSort}
      tabIndex={onClick ? 0 : -1}
      scope="col"
      style={stickyStyle}
      className={`px-2 py-2 font-semibold bg-amber-50 border-b-2 border-amber-200 cursor-pointer hover:bg-amber-100 select-none focus:outline-none focus:ring-2 focus:ring-amber-400 ${alignClass}`}
    >
      {children}
      <span className="text-amber-600" aria-hidden="true">{indicator}</span>
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
