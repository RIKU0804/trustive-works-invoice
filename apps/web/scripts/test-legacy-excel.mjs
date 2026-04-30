// 手動検証用: legacy Excel 出力をローカルで生成して読み戻す
//
// 実行: node --experimental-strip-types scripts/test-legacy-excel.mjs
//   （Node 22+ の type stripping を利用して TS をそのまま読み込む）
//
// 1. 6邸のサンプルで生成（既定の18邸枠を維持できるか）
// 2. 18邸ぴったり（境界）
// 3. 25邸のサンプルで生成（>18邸の動的拡張）
// 4. 生成された xlsx を ExcelJS で再読込し、数式・主要セルを検証

import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(
  join(process.cwd(), "lib", "excel", "legacy-format.ts")
).href;

function buildSample(propertiesCount) {
  const properties = [];
  for (let i = 0; i < propertiesCount; i++) {
    properties.push({
      propertyName: `テスト邸${i + 1}`,
      contractNo: `1000${i}-RA`,
      workSummary: i % 2 === 0 ? "防水" : "柱脚",
      amountSales: 800000 + i * 12345,
      amountShaho: 2000 + i * 100,
      amountSeisanka: 5000 + i * 200,
      amountMaterial: 300000 + i * 5000,
      staffName: ["山本", "熱田", "安保", null][i % 4],
    });
  }
  return properties;
}

async function generateAndVerify(label, properties) {
  console.log(`\n=== ${label}: ${properties.length}邸 ===`);

  // 動的 import（TS）は Node では不可なので、esbuild/tsx で起動した場合のみ可
  let buildLegacyWorkbook;
  let buildLegacyFileName;
  try {
    const mod = await import(moduleUrl);
    buildLegacyWorkbook = mod.buildLegacyWorkbook;
    buildLegacyFileName = mod.buildLegacyFileName;
  } catch (err) {
    console.error(
      "[skip] TS の直接 import に失敗。tsx 経由で実行してください: npx tsx scripts/test-legacy-excel.mjs"
    );
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const buf = await buildLegacyWorkbook({
    reportMonth: "2025-03",
    paymentDate: "2025-03-20",
    transferAmount: 5000000,
    offsetInclTax: 200000,
    monthlyMemo: "テスト用月次メモ。\n2行目もOK。",
    properties,
  });

  if (!Buffer.isBuffer(buf)) {
    throw new Error("buildLegacyWorkbook did not return a Buffer");
  }
  console.log(`  buffer size: ${buf.byteLength} bytes`);

  const fileName = buildLegacyFileName("2025-03");
  const filePath = join(tmpdir(), `verify-${properties.length}-${fileName}`);
  await writeFile(filePath, buf);
  console.log(`  written to: ${filePath}`);

  // 読み戻して検証
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet("3月");
  if (!sheet) throw new Error("sheet '3月' not found");

  const expectedSumRow = 5 + Math.max(properties.length, 18);
  const sumDFormula = sheet.getCell(`D${expectedSumRow}`).formula;
  console.log(`  D${expectedSumRow} formula: ${sumDFormula}`);

  const sumJFormula = sheet.getCell(`J${expectedSumRow}`).formula;
  console.log(`  J${expectedSumRow} formula: ${sumJFormula}`);

  const o8Formula = sheet.getCell("O8").formula;
  console.log(`  O8 (未入力カウント) formula: ${o8Formula}`);

  const o9Formula = sheet.getCell("O9").formula;
  console.log(`  O9 (合計) formula: ${o9Formula}`);

  // L5 (粗利率) formula
  const l5Formula = sheet.getCell("L5").formula;
  console.log(`  L5 (粗利率) formula: ${l5Formula}`);

  // J5 (粗利) formula
  const j5Formula = sheet.getCell("J5").formula;
  console.log(`  J5 (粗利) formula: ${j5Formula}`);

  // 担当者プルダウン
  const k5Validation = sheet.getCell("K5").dataValidation;
  console.log(
    `  K5 dataValidation: ${k5Validation ? JSON.stringify(k5Validation.formulae) : "(none)"}`
  );

  // 検証
  const expectedDFormula = `SUM(D5:D${expectedSumRow - 1})`;
  if (sumDFormula !== expectedDFormula) {
    throw new Error(
      `D${expectedSumRow} formula mismatch: expected ${expectedDFormula}, got ${sumDFormula}`
    );
  }

  const expectedO8 = `COUNTA(B5:B${expectedSumRow - 1})-COUNTIF(K5:K${expectedSumRow - 1},"<>")`;
  if (o8Formula !== expectedO8) {
    throw new Error(
      `O8 formula mismatch: expected ${expectedO8}, got ${o8Formula}`
    );
  }

  console.log(`  OK: shape verified for ${properties.length}邸`);
}

async function main() {
  await generateAndVerify("基準ケース", buildSample(6));
  await generateAndVerify("18邸ぴったり", buildSample(18));
  await generateAndVerify("25邸（拡張）", buildSample(25));
  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
