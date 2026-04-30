import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildLegacyFileName,
  buildLegacyWorkbook,
  type LegacyPropertyRow,
} from "@/lib/excel/legacy-format";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const EXPORT_FORMATS = ["csv", "xlsx"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

function parseFormat(value: string | null): ExportFormat {
  if (value && (EXPORT_FORMATS as readonly string[]).includes(value)) {
    return value as ExportFormat;
  }
  // 既存ツール互換のため、デフォルトは xlsx
  return "xlsx";
}

interface PropertyRow {
  property_name: string | null;
  contract_no: string | null;
  work_summary: string | null;
  amount_sales: number | string | null;
  amount_shaho: number | string | null;
  amount_seisanka: number | string | null;
  amount_material: number | string | null;
  amount_gross_profit: number | string | null;
  gross_profit_rate: number | string | null;
  staff_members: { name: string } | { name: string }[] | null;
  payment_notices:
    | { report_month: string; payment_date: string | null; transfer_amount: number | string | null; offset_incl_tax: number | string | null; file_name: string | null }
    | { report_month: string; payment_date: string | null; transfer_amount: number | string | null; offset_incl_tax: number | string | null; file_name: string | null }[]
    | null;
}

function pickStaffName(rel: PropertyRow["staff_members"]): string | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0]?.name ?? null;
  return rel.name ?? null;
}

function pickFirstNotice(rel: PropertyRow["payment_notices"]) {
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel;
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  const format = parseFormat(req.nextUrl.searchParams.get("format"));

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "month parameter required (YYYY-MM)" },
      { status: 400 }
    );
  }

  const supabase = createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const monthStart = `${month}-01`;

  const { data: propertiesRaw, error } = await supabase
    .from("properties")
    .select(
      `
      property_name,
      contract_no,
      work_summary,
      amount_sales,
      amount_shaho,
      amount_seisanka,
      amount_material,
      amount_gross_profit,
      gross_profit_rate,
      staff_members(name),
      payment_notices!inner(report_month, payment_date, transfer_amount, offset_incl_tax, file_name)
    `
    )
    .eq("organization_id", membership.organization_id)
    .eq("payment_notices.report_month", monthStart)
    .order("property_name");

  if (error) {
    return NextResponse.json(
      { error: "データ取得に失敗しました" },
      { status: 500 }
    );
  }

  const properties = (propertiesRaw ?? []) as unknown as PropertyRow[];

  const { data: memoRow } = await supabase
    .from("monthly_memos")
    .select("content")
    .eq("organization_id", membership.organization_id)
    .eq("report_month", monthStart)
    .maybeSingle();

  const monthlyMemo = memoRow?.content ?? null;

  if (format === "csv") {
    return buildCsvResponse(properties, month);
  }

  return await buildXlsxResponse(properties, month, monthlyMemo);
}

// ----------------------------------------------------------------------
// CSV (既存実装を維持)
// ----------------------------------------------------------------------

function buildCsvResponse(properties: PropertyRow[], month: string): NextResponse {
  const headers = [
    "物件名",
    "契約番号",
    "工事概要",
    "売上",
    "社保",
    "精算額",
    "材料",
    "粗利",
    "粗利率(%)",
    "担当者",
  ];

  const rows = properties.map((p) => {
    const grossProfitRate =
      p.gross_profit_rate != null
        ? (Number(p.gross_profit_rate) * 100).toFixed(1)
        : "0.0";
    const staffName = pickStaffName(p.staff_members) ?? "";
    return [
      p.property_name ?? "",
      p.contract_no ?? "",
      p.work_summary ?? "",
      String(toNumber(p.amount_sales)),
      String(toNumber(p.amount_shaho)),
      String(toNumber(p.amount_seisanka)),
      String(toNumber(p.amount_material)),
      String(toNumber(p.amount_gross_profit)),
      grossProfitRate,
      staffName,
    ];
  });

  // CSV injection対策: =, +, -, @ で始まるセルは ' を前置してExcelの数式実行を防ぐ
  const escapeCell = (cell: string): string => {
    const safe = /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csvLines = [headers, ...rows].map((row) =>
    row.map(escapeCell).join(",")
  );

  const bom = "﻿";
  const csv = bom + csvLines.join("\r\n");
  const filename = `export_${month}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// ----------------------------------------------------------------------
// XLSX (legacy format)
// ----------------------------------------------------------------------

async function buildXlsxResponse(
  properties: PropertyRow[],
  month: string,
  monthlyMemo: string | null
): Promise<NextResponse> {
  const firstNotice =
    properties.length > 0 ? pickFirstNotice(properties[0].payment_notices) : null;

  const rows: LegacyPropertyRow[] = properties.map((p) => ({
    propertyName: p.property_name ?? "",
    contractNo: p.contract_no ?? null,
    workSummary: p.work_summary ?? null,
    amountSales: toNumber(p.amount_sales),
    amountShaho: toNumber(p.amount_shaho),
    amountSeisanka: toNumber(p.amount_seisanka),
    amountMaterial: toNumber(p.amount_material),
    staffName: pickStaffName(p.staff_members),
  }));

  const buffer = await buildLegacyWorkbook({
    reportMonth: month,
    paymentDate: firstNotice?.payment_date ?? null,
    transferAmount: firstNotice ? toNumber(firstNotice.transfer_amount) : null,
    offsetInclTax: firstNotice ? toNumber(firstNotice.offset_incl_tax) : null,
    monthlyMemo,
    properties: rows,
  });

  const filename = buildLegacyFileName(month);
  const encodedFilename = encodeURIComponent(filename);
  // ASCII fallback for legacy clients (HTTP headers can only contain ByteString chars)
  const asciiFallback = `export_${month}.xlsx`;

  // Buffer (ArrayBufferLike) を BodyInit が受け付ける ArrayBuffer 由来の
  // Uint8Array に変換する
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);

  return new NextResponse(arrayBuffer, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
