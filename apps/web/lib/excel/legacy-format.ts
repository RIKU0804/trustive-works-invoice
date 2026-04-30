/**
 * 既存invoice-tool互換のExcel出力（legacy format）
 *
 * 仕様: docs/07-excel-export.md / docs/reference/invoice-tool-analysis.md
 *
 * 邸数 (n_tei) は動的（18邸を基準とし、超過時は拡張）。
 * シート構成・セル位置・数式・条件付き書式は既存ツールに合わせて再現する。
 */

import ExcelJS from "exceljs";

// ----------------------------------------------------------------------
// 定数
// ----------------------------------------------------------------------

/** データ行は5行目から始まる */
const DATA_START_ROW = 5;

/** 既定の邸数枠（既存ツールが18邸を基準にしているため） */
const DEFAULT_TEI_CAPACITY = 18;

/** 担当者プルダウン候補のフォールバック（実運用ではDBから注入される） */
const DEFAULT_STAFF_OPTIONS: readonly string[] = [];

/** 数値フォーマット（既存ツール互換: マイナスは赤＋▲） */
const NUMBER_FORMAT = '#,##0;[Red]▲#,##0';

/** パーセント表示（小数1桁） */
const PERCENT_FORMAT = '0.0%';

/** 担当邸数集計位置（先頭3名分 + 未入力 + 合計） */
const TANTO_TEISU_RANGE = {
  titleCell: "N3",
  headerRow: 4,
  staffStartRow: 5,    // 先頭3名分の表示行（5,6,7）
  unassignedRow: 8,
  totalRow: 9,
};

/** 班長別配色のパレット（DB のstaff順に割り当てる） */
const STAFF_COLOR_PALETTE: Array<{ font: string; fill: string }> = [
  { font: "FF0F5132", fill: "FFD1E7DD" }, // 緑
  { font: "FF8A4B00", fill: "FFFCE5C2" }, // オレンジ
  { font: "FF0B3D91", fill: "FFCFE2FF" }, // 青
];

// ----------------------------------------------------------------------
// 型
// ----------------------------------------------------------------------

export interface LegacyPropertyRow {
  propertyName: string;
  contractNo: string | null;
  workSummary: string | null;
  amountSales: number;
  amountShaho: number;
  amountSeisanka: number;
  amountMaterial: number;
  /** 外注小林（PDFには現状無し、将来用に0で確保） */
  amountSubcontractKobayashi?: number;
  /** 外注南（同上） */
  amountSubcontractMinami?: number;
  staffName: string | null;
}

export interface LegacyExportInput {
  /** 対象月: "YYYY-MM" */
  reportMonth: string;
  /** "YYYY-MM-DD" 形式 */
  paymentDate?: string | null;
  /** 振込金額（税込） */
  transferAmount?: number | null;
  /** 税込相殺額 */
  offsetInclTax?: number | null;
  /** 月次メモ */
  monthlyMemo?: string | null;
  /** 邸別データ */
  properties: LegacyPropertyRow[];
  /** 担当者リスト（DBから取得・表示順で渡す） */
  staffOptions?: readonly string[];
}

// ----------------------------------------------------------------------
// 公開関数
// ----------------------------------------------------------------------

/**
 * legacy format の Excel を生成し、Buffer を返す。
 */
export async function buildLegacyWorkbook(
  input: LegacyExportInput
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "invoice-saas";
  workbook.created = new Date();

  const sheetName = formatSheetName(input.reportMonth);
  const sheet = workbook.addWorksheet(sheetName);

  buildSheet(sheet, input);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/**
 * シート名フォーマット（"YYYY-MM" → "M月"）
 */
export function formatSheetName(reportMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(reportMonth);
  if (!match) return reportMonth;
  const month = parseInt(match[2], 10);
  return `${month}月`;
}

/**
 * ファイル名生成（仕様書準拠）
 */
export function buildLegacyFileName(reportMonth: string, today = new Date()): string {
  const yyyymm = reportMonth.replace("-", "");
  const yyyymmdd = formatYyyymmdd(today);
  return `集計用_${yyyymm}_${yyyymmdd}.xlsx`;
}

// ----------------------------------------------------------------------
// シート構築
// ----------------------------------------------------------------------

function buildSheet(sheet: ExcelJS.Worksheet, input: LegacyExportInput): void {
  const teiCount = Math.max(input.properties.length, DEFAULT_TEI_CAPACITY);
  const dataLastRow = DATA_START_ROW + teiCount - 1; // 例: 18邸なら 22
  const sumRow = dataLastRow + 1; // 例: 23
  const usedRowCount = input.properties.length;
  const staffOptions = input.staffOptions ?? DEFAULT_STAFF_OPTIONS;

  configureColumns(sheet);
  writeTitle(sheet, input);
  writeColumnHeaders(sheet);
  writeDataRows(sheet, input.properties, dataLastRow);
  writeSumRow(sheet, sumRow, dataLastRow);
  writeBottomTotals(sheet, sumRow, dataLastRow);
  writeStaffSummary(sheet, sumRow, dataLastRow, staffOptions);
  writeTantoTeisu(sheet, dataLastRow, staffOptions);
  writeTransferReconciliation(sheet, sumRow, input);
  writeMonthlyMemo(sheet, sumRow, input.monthlyMemo);
  applyDataValidation(sheet, dataLastRow, staffOptions);
  applyConditionalFormatting(sheet, dataLastRow, usedRowCount, staffOptions);
}

// ----------------------------------------------------------------------
// 列幅 / シート設定
// ----------------------------------------------------------------------

function configureColumns(sheet: ExcelJS.Worksheet): void {
  // 列幅は仕様書 docs/07-excel-export.md の通り
  sheet.columns = [
    { width: 4 },  // A: 連番
    { width: 12 }, // B: 顧客名
    { width: 14 }, // C: 工事名称
    { width: 28 }, // D: ①税抜
    { width: 28 }, // E: ②社保
    { width: 28 }, // F: ③生産課
    { width: 28 }, // G: ④材料費
    { width: 28 }, // H: ⑤外注小林
    { width: 28 }, // I: ⑥外注南
    { width: 28 }, // J: ⑦粗利
    { width: 8 },  // K: 班長
    { width: 10 }, // L: 粗利率
    { width: 4 },  // M: 余白
    { width: 14 }, // N: 担当邸数ラベル
    { width: 10 }, // O: 担当邸数値
  ];
}

// ----------------------------------------------------------------------
// タイトル / ヘッダー
// ----------------------------------------------------------------------

function writeTitle(sheet: ExcelJS.Worksheet, input: LegacyExportInput): void {
  // 1行目: タイトル + 更新日
  const titleCell = sheet.getCell("B1");
  titleCell.value = "受注一覧表";
  titleCell.font = { bold: true, size: 16 };
  sheet.mergeCells("B1:F1");

  const updatedCell = sheet.getCell("J1");
  updatedCell.value = `${formatYyyyMmDdSlash(new Date())} 更新`;
  updatedCell.alignment = { horizontal: "right" };
  sheet.mergeCells("J1:L1");

  // 2行目: 対象月 + 注釈
  const subtitleCell = sheet.getCell("B2");
  subtitleCell.value = `${formatJapaneseMonth(input.reportMonth)} 着工=受注 ベース`;
  subtitleCell.font = { bold: true };
  sheet.mergeCells("B2:F2");

  const noteCell = sheet.getCell("J2");
  noteCell.value = "＊数字は【税抜き】です。";
  noteCell.alignment = { horizontal: "right" };
  sheet.mergeCells("J2:L2");
}

function writeColumnHeaders(sheet: ExcelJS.Worksheet): void {
  // 3行目: 大カテゴリ
  sheet.getCell("B3").value = "顧客名";
  sheet.getCell("C3").value = "工事名称";
  sheet.getCell("D3").value = "一般売上";
  sheet.getCell("L3").value = "【担当邸数】";

  // 4行目: 各列のサブヘッダー
  const subHeaders: Record<string, string> = {
    D4: "①税抜",
    E4: "②社保",
    F4: "③生産課",
    G4: "④材料費",
    H4: "⑤外注小林",
    I4: "⑥外注南",
    J4: "⑦粗利益",
    K4: "班長",
    L4: "粗利率",
  };

  for (const [addr, value] of Object.entries(subHeaders)) {
    const cell = sheet.getCell(addr);
    cell.value = value;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  }

  // 3行目もbold
  ["B3", "C3", "D3", "L3"].forEach((addr) => {
    const cell = sheet.getCell(addr);
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
}

// ----------------------------------------------------------------------
// データ行
// ----------------------------------------------------------------------

function writeDataRows(
  sheet: ExcelJS.Worksheet,
  properties: LegacyPropertyRow[],
  dataLastRow: number
): void {
  for (let i = 0; i < properties.length; i++) {
    const r = DATA_START_ROW + i;
    const p = properties[i];

    sheet.getCell(`A${r}`).value = i + 1;
    sheet.getCell(`B${r}`).value = p.propertyName ?? "";
    sheet.getCell(`C${r}`).value = p.workSummary ?? "";
    sheet.getCell(`D${r}`).value = numberOrZero(p.amountSales);
    sheet.getCell(`E${r}`).value = numberOrZero(p.amountShaho);
    sheet.getCell(`F${r}`).value = numberOrZero(p.amountSeisanka);
    sheet.getCell(`G${r}`).value = numberOrZero(p.amountMaterial);
    sheet.getCell(`H${r}`).value = numberOrZero(p.amountSubcontractKobayashi);
    sheet.getCell(`I${r}`).value = numberOrZero(p.amountSubcontractMinami);

    // J: 粗利 = ROUNDDOWN(D-E-F-G-H-I, 0)
    const grossProfit =
      numberOrZero(p.amountSales) -
      numberOrZero(p.amountShaho) -
      numberOrZero(p.amountSeisanka) -
      numberOrZero(p.amountMaterial) -
      numberOrZero(p.amountSubcontractKobayashi) -
      numberOrZero(p.amountSubcontractMinami);
    sheet.getCell(`J${r}`).value = {
      formula: `ROUNDDOWN(D${r}-E${r}-F${r}-G${r}-H${r}-I${r},0)`,
      result: Math.floor(grossProfit),
    };

    // K: 班長
    sheet.getCell(`K${r}`).value = p.staffName ?? "";

    // L: 粗利率 = IFERROR(J/D, "")
    const rate =
      numberOrZero(p.amountSales) > 0
        ? grossProfit / numberOrZero(p.amountSales)
        : 0;
    sheet.getCell(`L${r}`).value = {
      formula: `IFERROR(J${r}/D${r},"")`,
      result: rate,
    };
  }

  // データ全行の書式（空行含めて DEFAULT_TEI_CAPACITY 行ぶん）
  for (let r = DATA_START_ROW; r <= dataLastRow; r++) {
    for (const col of ["D", "E", "F", "G", "H", "I", "J"]) {
      const cell = sheet.getCell(`${col}${r}`);
      cell.numFmt = NUMBER_FORMAT;
      cell.alignment = { horizontal: "right" };
    }
    const lCell = sheet.getCell(`L${r}`);
    lCell.numFmt = PERCENT_FORMAT;
    lCell.alignment = { horizontal: "right" };

    sheet.getCell(`A${r}`).alignment = { horizontal: "center" };
    sheet.getCell(`K${r}`).alignment = { horizontal: "center" };
  }
}

// ----------------------------------------------------------------------
// 合計行
// ----------------------------------------------------------------------

function writeSumRow(
  sheet: ExcelJS.Worksheet,
  sumRow: number,
  dataLastRow: number
): void {
  const cols: Array<{ col: string; needsRoundDown?: boolean }> = [
    { col: "D" },
    { col: "E" },
    { col: "F" },
    { col: "G" },
    { col: "H" },
    { col: "I" },
    { col: "J", needsRoundDown: true },
  ];

  for (const { col, needsRoundDown } of cols) {
    const cell = sheet.getCell(`${col}${sumRow}`);
    if (needsRoundDown) {
      cell.value = {
        formula: `ROUNDDOWN(SUM(${col}${DATA_START_ROW}:${col}${dataLastRow}),0)`,
        result: 0,
      };
    } else {
      cell.value = {
        formula: `SUM(${col}${DATA_START_ROW}:${col}${dataLastRow})`,
        result: 0,
      };
    }
    cell.numFmt = NUMBER_FORMAT;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "right" };
    cell.border = { top: { style: "double" } };
  }

  // L列: 粗利率 = IFERROR(J/D, "")
  const lCell = sheet.getCell(`L${sumRow}`);
  lCell.value = {
    formula: `IFERROR(J${sumRow}/D${sumRow},"")`,
    result: 0,
  };
  lCell.numFmt = PERCENT_FORMAT;
  lCell.font = { bold: true };
  lCell.alignment = { horizontal: "right" };
  lCell.border = { top: { style: "double" } };
}

function writeBottomTotals(
  sheet: ExcelJS.Worksheet,
  sumRow: number,
  dataLastRow: number
): void {
  // 売上合計ラベル: C{sum_row}（仕様書 docs/07-excel-export.md:55）
  sheet.getCell(`C${sumRow}`).value = "売上合計";
  sheet.getCell(`C${sumRow}`).font = { bold: true };
  sheet.getCell(`C${sumRow}`).alignment = { horizontal: "right" };

  // sum_row+1 行: 「原材料 経費 合計」ラベル + I列に SUM(E5:I{data_last_row})
  const labelRow = sumRow + 1;

  sheet.getCell(`E${labelRow}`).value = "原材料 経費 合計";
  sheet.getCell(`E${labelRow}`).font = { bold: true };
  sheet.mergeCells(`E${labelRow}:H${labelRow}`);

  const iCell = sheet.getCell(`I${labelRow}`);
  iCell.value = {
    formula: `SUM(E${DATA_START_ROW}:I${dataLastRow})`,
    result: 0,
  };
  iCell.numFmt = NUMBER_FORMAT;
  iCell.font = { bold: true };
  iCell.alignment = { horizontal: "right" };

  // 利益ラベル: J{sum_row + 1}
  sheet.getCell(`J${labelRow}`).value = "利益";
  sheet.getCell(`J${labelRow}`).font = { bold: true };
  sheet.getCell(`J${labelRow}`).alignment = { horizontal: "center" };
}

// ----------------------------------------------------------------------
// 班長別集計
// ----------------------------------------------------------------------

function writeStaffSummary(
  sheet: ExcelJS.Worksheet,
  sumRow: number,
  dataLastRow: number,
  staffOptions: readonly string[]
): void {
  const startRow = sumRow + 5;

  staffOptions.forEach((staff, idx) => {
    const r = startRow + idx;
    sheet.getCell(`K${r}`).value = staff;
    sheet.getCell(`K${r}`).font = { bold: true };
    sheet.getCell(`K${r}`).alignment = { horizontal: "center" };

    sheet.getCell(`L${r}`).value = {
      formula: `SUMIF(K${DATA_START_ROW}:K${dataLastRow},K${r},J${DATA_START_ROW}:J${dataLastRow})`,
      result: 0,
    };
    sheet.getCell(`L${r}`).numFmt = NUMBER_FORMAT;
    sheet.getCell(`L${r}`).alignment = { horizontal: "right" };
  });
}

// ----------------------------------------------------------------------
// 担当邸数 N3:O9
// ----------------------------------------------------------------------

function writeTantoTeisu(
  sheet: ExcelJS.Worksheet,
  dataLastRow: number,
  staffOptions: readonly string[]
): void {
  const { titleCell, headerRow, staffStartRow, unassignedRow, totalRow } =
    TANTO_TEISU_RANGE;

  sheet.getCell(titleCell).value = "【担当邸数】";
  sheet.getCell(titleCell).font = { bold: true };

  sheet.getCell(`N${headerRow}`).value = "班長";
  sheet.getCell(`O${headerRow}`).value = "邸数";
  sheet.getCell(`N${headerRow}`).font = { bold: true };
  sheet.getCell(`O${headerRow}`).font = { bold: true };
  sheet.getCell(`N${headerRow}`).alignment = { horizontal: "center" };
  sheet.getCell(`O${headerRow}`).alignment = { horizontal: "center" };

  // 先頭3名分の班長名（足りなければ空欄）
  const firstThree = staffOptions.slice(0, 3);
  const staffRows = [staffStartRow, staffStartRow + 1, staffStartRow + 2];
  staffRows.forEach((row, idx) => {
    sheet.getCell(`N${row}`).value = firstThree[idx] ?? "";
  });
  sheet.getCell(`N${unassignedRow}`).value = "未入力";
  sheet.getCell(`N${totalRow}`).value = "合計";
  sheet.getCell(`N${totalRow}`).font = { bold: true };

  // O5:O7 = COUNTIF(K5:K{n}, N{r})
  for (const r of staffRows) {
    sheet.getCell(`O${r}`).value = {
      formula: `COUNTIF(K${DATA_START_ROW}:K${dataLastRow},N${r})`,
      result: 0,
    };
    sheet.getCell(`O${r}`).alignment = { horizontal: "right" };
  }

  // O8 = COUNTA(B5:B{n}) - COUNTIF(K5:K{n},"<>")
  sheet.getCell(`O${unassignedRow}`).value = {
    formula: `COUNTA(B${DATA_START_ROW}:B${dataLastRow})-COUNTIF(K${DATA_START_ROW}:K${dataLastRow},"<>")`,
    result: 0,
  };
  sheet.getCell(`O${unassignedRow}`).alignment = { horizontal: "right" };

  // O9 = SUM(O5:O8)
  sheet.getCell(`O${totalRow}`).value = {
    formula: `SUM(O${staffStartRow}:O${unassignedRow})`,
    result: 0,
  };
  sheet.getCell(`O${totalRow}`).alignment = { horizontal: "right" };
  sheet.getCell(`O${totalRow}`).font = { bold: true };
}

// ----------------------------------------------------------------------
// 振込金額照合
// ----------------------------------------------------------------------

function writeTransferReconciliation(
  sheet: ExcelJS.Worksheet,
  sumRow: number,
  input: LegacyExportInput
): void {
  const startRow = sumRow + 13;

  const transferAmount = numberOrZero(input.transferAmount);
  const offsetInclTax = numberOrZero(input.offsetInclTax);

  const titleCell = sheet.getCell(`B${startRow}`);
  titleCell.value = "【振込金額照合（税抜⇔税込の二重計算）】";
  titleCell.font = { bold: true };
  sheet.mergeCells(`B${startRow}:F${startRow}`);

  const labels: Array<[string, string, ExcelJS.CellValue]> = [
    [`B${startRow + 1}`, "① 振込金額(税込)", transferAmount],
    [`B${startRow + 2}`, "② 税込相殺(PDF・手入力)", offsetInclTax],
    [`B${startRow + 3}`, "③ 税込工事代計(① − ②)", { formula: `D${startRow + 1}-D${startRow + 2}`, result: transferAmount - offsetInclTax }],
    [`B${startRow + 4}`, "④ 税抜逆算(③ ÷ 1.1)", { formula: `ROUND(D${startRow + 3}/1.1,0)`, result: Math.round((transferAmount - offsetInclTax) / 1.1) }],
    [`B${startRow + 5}`, `⑤ Excel税抜合計(J${sumRow})`, { formula: `J${sumRow}`, result: 0 }],
    [`B${startRow + 6}`, "⑥ 差額(⑤ − ④)", { formula: `D${startRow + 5}-D${startRow + 4}`, result: 0 }],
  ];

  for (const [labelAddr, label, value] of labels) {
    const labelCell = sheet.getCell(labelAddr);
    labelCell.value = label;

    const valueAddr = labelAddr.replace("B", "D");
    const valueCell = sheet.getCell(valueAddr);
    valueCell.value = value;
    valueCell.numFmt = NUMBER_FORMAT;
    valueCell.alignment = { horizontal: "right" };

    sheet.mergeCells(`${labelAddr}:C${labelAddr.slice(1)}`);
  }

  const noteCell = sheet.getCell(`B${startRow + 7}`);
  noteCell.value = "※±数円→インボイス端数差(正常) / 大きな差→PDF読取エラーの可能性";
  noteCell.font = { italic: true, color: { argb: "FF666666" } };
  sheet.mergeCells(`B${startRow + 7}:F${startRow + 7}`);

  // 支払日（任意）
  if (input.paymentDate) {
    const payDateCell = sheet.getCell(`H${startRow + 1}`);
    payDateCell.value = `支払日: ${input.paymentDate}`;
    payDateCell.alignment = { horizontal: "left" };
    sheet.mergeCells(`H${startRow + 1}:L${startRow + 1}`);
  }

  // ⑥差額の条件付き書式（±10円）
  const diffCellAddr = `D${startRow + 6}`;
  sheet.addConditionalFormatting({
    ref: diffCellAddr,
    rules: [
      {
        type: "expression",
        formulae: [`ABS(${diffCellAddr})>10`],
        priority: 1,
        style: {
          font: { color: { argb: "FFFFFFFF" }, bold: true },
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFCC0000" } },
        },
      },
      {
        type: "expression",
        formulae: [`ABS(${diffCellAddr})<=10`],
        priority: 2,
        style: {
          font: { color: { argb: "FF0F5132" }, bold: true },
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD1E7DD" } },
        },
      },
    ],
  });
}

// ----------------------------------------------------------------------
// 月次メモ
// ----------------------------------------------------------------------

function writeMonthlyMemo(
  sheet: ExcelJS.Worksheet,
  sumRow: number,
  memo: string | null | undefined
): void {
  const startRow = sumRow + 13 + 9; // 振込照合セクションの下
  const titleCell = sheet.getCell(`B${startRow}`);
  titleCell.value = "【月次メモ】";
  titleCell.font = { bold: true };
  sheet.mergeCells(`B${startRow}:L${startRow}`);

  const memoCell = sheet.getCell(`B${startRow + 1}`);
  memoCell.value = memo ?? "";
  memoCell.alignment = { wrapText: true, vertical: "top" };
  sheet.mergeCells(`B${startRow + 1}:L${startRow + 4}`);
  sheet.getRow(startRow + 1).height = 24;
  sheet.getRow(startRow + 2).height = 24;
  sheet.getRow(startRow + 3).height = 24;
  sheet.getRow(startRow + 4).height = 24;

  memoCell.border = {
    top: { style: "thin" },
    bottom: { style: "thin" },
    left: { style: "thin" },
    right: { style: "thin" },
  };
}

// ----------------------------------------------------------------------
// 入力規則（K列プルダウン）
// ----------------------------------------------------------------------

function applyDataValidation(
  sheet: ExcelJS.Worksheet,
  dataLastRow: number,
  staffOptions: readonly string[]
): void {
  if (staffOptions.length === 0) return;
  const list = staffOptions.join(",");
  for (let r = DATA_START_ROW; r <= dataLastRow; r++) {
    sheet.getCell(`K${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${list}"`],
      showErrorMessage: true,
      errorTitle: "班長名エラー",
      error: `${staffOptions.join(" / ")} から選んでください`,
    };
  }
}

// ----------------------------------------------------------------------
// 条件付き書式
// ----------------------------------------------------------------------

function applyConditionalFormatting(
  sheet: ExcelJS.Worksheet,
  dataLastRow: number,
  usedRowCount: number,
  staffOptions: readonly string[]
): void {
  // 班長未入力（K列が空 かつ B列が埋まっている）→ 薄黄
  sheet.addConditionalFormatting({
    ref: `K${DATA_START_ROW}:K${dataLastRow}`,
    rules: [
      {
        type: "expression",
        formulae: [`AND($B${DATA_START_ROW}<>"",$K${DATA_START_ROW}="")`],
        priority: 1,
        style: {
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFF9E6" } },
        },
      },
    ],
  });

  // 班長別の色分け（K列） — DBの並び順にパレットを割り当て
  staffOptions.forEach((staff, idx) => {
    const colors = STAFF_COLOR_PALETTE[idx % STAFF_COLOR_PALETTE.length];
    sheet.addConditionalFormatting({
      ref: `K${DATA_START_ROW}:K${dataLastRow}`,
      rules: [
        {
          type: "containsText",
          operator: "containsText",
          text: staff,
          priority: 10 + idx,
          style: {
            font: { color: { argb: colors.font }, bold: true },
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: colors.fill } },
          },
        },
      ],
    });
  });

  // 粗利率（L列）の色分け：低い=赤、高い=緑
  sheet.addConditionalFormatting({
    ref: `L${DATA_START_ROW}:L${dataLastRow}`,
    rules: [
      {
        type: "cellIs",
        operator: "lessThan",
        formulae: ["0.2"],
        priority: 20,
        style: {
          font: { color: { argb: "FFCC0000" } },
        },
      },
      {
        type: "cellIs",
        operator: "greaterThan",
        formulae: ["0.3999"],
        priority: 21,
        style: {
          font: { color: { argb: "FF0F5132" }, bold: true },
        },
      },
    ],
  });

  // 担当邸数「未入力」の値が0より大きい → 薄黄
  const { unassignedRow } = TANTO_TEISU_RANGE;
  sheet.addConditionalFormatting({
    ref: `O${unassignedRow}`,
    rules: [
      {
        type: "cellIs",
        operator: "greaterThan",
        formulae: ["0"],
        priority: 30,
        style: {
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFF9E6" } },
          font: { bold: true, color: { argb: "FFA94400" } },
        },
      },
    ],
  });

  // データ件数を超えた行は薄グレー（視覚ガイド）
  if (usedRowCount > 0 && usedRowCount < dataLastRow - DATA_START_ROW + 1) {
    const emptyStartRow = DATA_START_ROW + usedRowCount;
    sheet.addConditionalFormatting({
      ref: `A${emptyStartRow}:L${dataLastRow}`,
      rules: [
        {
          type: "expression",
          formulae: [`$B${emptyStartRow}=""`],
          priority: 40,
          style: {
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF7F7F7" } },
          },
        },
      ],
    });
  }
}

// ----------------------------------------------------------------------
// 補助関数
// ----------------------------------------------------------------------

function numberOrZero(value: number | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatYyyyMmDdSlash(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}/${m}/${d}`;
}

function formatYyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatJapaneseMonth(reportMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(reportMonth);
  if (!match) return reportMonth;
  return `${match[1]}年${parseInt(match[2], 10)}月`;
}
