# 07. Excel出力仕様

## 2つのフォーマット

ユーザーはExcel出力時にフォーマットを選べる：

1. **既存Excel互換（legacy）**: 既存invoice-toolが出力していた `集計用.xlsx` の構造を再現
2. **シンプル一覧（simple）**: フラットなテーブル形式（賞与計算しやすい）

ライブラリは `ExcelJS` を使う（テンプレ読込・書式コピー対応）。

## フォーマット1: 既存Excel互換（legacy）

### シート構成
- 月ごとに1シート（例: `1月`, `2月`, ..., `12月`）
- 既存ツールと同じレイアウト

### 1シートの構造（基準: 18邸まで、超過時は動的に拡張）

```
A    B          C            D       E      F       G        H        I       J        K       L
─────────────────────────────────────────────────────────────────────────────────────────────────
                  受注一覧表                                            2025/3/22 更新
                  2025年3月 着工=受注 ベース                              ＊数字は【税抜き】です。
   顧客名     工事名称     一般売上                                                       【担当邸数】
                          ①税抜  ②社保  ③生産課  ④材料費  ⑤外注小林  ⑥外注南  ⑦粗利益  班長  粗利率   班長  邸数
1  中川 明子   防水         939621  2341    15000   579873                          342407  山本    36.4%   山本  3
2  原 寛       防水         231088                  100776                          130312  山本             熱田  2
... (邸ごとに1行、最大18行)                                                                          安保  1
                                                                                                       未入力 0
                                                                                                       合計  6
                                                                                              
                          [SUM]   [SUM]   [SUM]   [SUM]    [SUM]    [SUM]    [SUM]            [JsumD]
            売上合計             原材料 経費 合計                       [JsumI]  利益
                                 [SUM(E5:I)]
                                                                                
                                                                                山本    [SUMIF]
                                                                                熱田    [SUMIF]
                                                                                安保    [SUMIF]

   【振込金額照合（税抜⇔税込の二重計算）】
   ① 振込金額(税込)     [振込金額]
   ② 税込相殺(PDF・手入力) [相殺]
   ③ 税込工事代計(① − ②)  [=D-D]
   ④ 税抜逆算(③ ÷ 1.1)    [=ROUND(D/1.1)]
   ⑤ Excel税抜合計(J{sum_row}) [=J{sum_row}]
   ⑥ 差額(⑤ − ④)         [=D-D]
   ※±数円→インボイス端数差(正常) / 大きな差→PDF読取エラーの可能性
```

### 詳細セル位置（n_tei = 邸数 とする）

- データ行: `5` 〜 `4 + n_tei`
- 合計行: `5 + n_tei`
- 売上合計ラベル: `C{sum_row}`
- 原材料経費合計式: `I{sum_row + 1} = SUM(E5:I{data_last_row})`
- 利益ラベル: `J{sum_row + 1}`
- 班長集計開始: `sum_row + 5`
  - `K{r} = '山本'`, `L{r} = =SUMIF(K5:K{data_last_row}, K{r}, J5:J{data_last_row})`
  - 同様に熱田、安保
- 振込金額照合開始: `sum_row + 13`

### 各セルの数式

```
D{r}（i行目の①税抜）       = item.amountSales （ハードコード or 加算式）
E{r}（②社保）             = item.amountShaho
F{r}（③生産課）           = item.amountSeisanka
G{r}（④材料費）           = item.amountMaterial
J{r}（⑦粗利）             = ROUNDDOWN(D{r}-E{r}-F{r}-G{r}-H{r}-I{r}, 0)
L{r}（粗利率）             = IFERROR(J{r}/D{r}, "")

D{sum_row} 〜 I{sum_row}   = SUM(D5:D{data_last_row}) 等
J{sum_row}                = ROUNDDOWN(J5+J6+...+J{data_last_row}, 0)
L{sum_row}                = IFERROR(J{sum_row}/D{sum_row}, "")
```

### 担当者プルダウン（K列）

```typescript
sheet.dataValidations.add(`K5:K${dataLastRow}`, {
  type: 'list',
  allowBlank: true,
  formulae: ['"山本,熱田,安保"'],
  errorTitle: '班長名エラー',
  error: '山本 / 熱田 / 安保 から選んでください',
});
```

### 条件付き書式

- 班長未入力（K列が空でB列が埋まっている）→ 薄黄色背景
- 担当邸数の「未入力」が0より大きい → 薄黄色
- 振込照合の差額：±10円超 → 赤、±10円以内 → 緑
- 班長名による配置: 山本=左寄せ緑、熱田=中央オレンジ、安保=右寄せ青

### 担当邸数カウント（N3:O9）

```
N3: 【担当邸数】
N4: 班長          O4: 邸数
N5: 山本          O5: =COUNTIF(K5:K{n}, N5)
N6: 熱田          O6: =COUNTIF(K5:K{n}, N6)
N7: 安保          O7: =COUNTIF(K5:K{n}, N7)
N8: 未入力        O8: =COUNTA(B5:B{n}) - COUNTIF(K5:K{n},"<>")
N9: 合計          O9: =SUM(O5:O8)
```

### 列幅
- A列: 4
- B列: 12
- C列: 14
- D〜J: 28（金額表示用）
- K列: 8
- L列: 10
- N列: 14
- O列: 10

## フォーマット2: シンプル一覧（simple）

賞与計算で扱いやすいフラットテーブル。1シートに全期間の全邸を縦に並べる。

### 列構成

```
| 月       | 邸名      | 契約NO       | 工事名 | 担当者 | ①税抜    | ②社保 | ③生産課 | ④材料費 | ⑦粗利益  | 粗利率 | 支払日   |
|----------|----------|--------------|--------|--------|----------|-------|---------|----------|----------|--------|----------|
| 2025-03  | 中川 明子 | 10352M1-RA   | 防水   | 山本   | 939,621  | 2,341 | 15,000  | 579,873  | 342,407  | 36.4%  | 2025/3/20 |
| 2025-03  | 原 寛    | 10598YB-RA   | 防水   | 山本   | 231,088  | 0     | 0       | 100,776  | 130,312  | 56.4%  | 2025/3/20 |
| ...      | ...      | ...          | ...    | ...    | ...      | ...   | ...     | ...      | ...      | ...    | ...       |
```

### サブシート（オプション）

- `担当者別集計`: 担当者ごとの月別合計
- `月次サマリ`: 月ごとの合計

## ExcelJS実装の擬似コード

```typescript
// lib/excel/exporter.ts
import ExcelJS from 'exceljs';

export async function exportLegacy(
  organizationId: string,
  options: { reportMonth: string }
): Promise<Buffer> {
  // 1. テンプレートをロード（任意・無くても動く）
  const wb = new ExcelJS.Workbook();
  // または: await wb.xlsx.readFile('./templates/集計用.xlsx');

  // 2. データ取得
  const properties = await fetchProperties(organizationId, options);

  // 3. シート構築
  const sheetName = formatSheetName(options.reportMonth); // '3月'
  const ws = wb.addWorksheet(sheetName);
  buildLegacyLayout(ws, properties);

  // 4. バイナリ生成
  return await wb.xlsx.writeBuffer() as Buffer;
}

export async function exportSimple(
  organizationId: string,
  options: { from: string; to: string; staffMemberId?: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('一覧');

  ws.columns = [
    { header: '月', key: 'reportMonth', width: 10 },
    { header: '邸名', key: 'propertyName', width: 14 },
    // ...
  ];

  const properties = await fetchProperties(organizationId, options);
  for (const p of properties) {
    ws.addRow({
      reportMonth: format(p.reportMonth, 'yyyy-MM'),
      propertyName: p.propertyName,
      // ...
    });
  }

  // ヘッダー書式
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5984' } };

  return await wb.xlsx.writeBuffer() as Buffer;
}
```

## ExcelJSの注意点

1. **数式と値の両方を持つセル**: ExcelJSで数式を書くと、`{ formula: 'SUM(D5:D22)', result: 100000 }` の形で `result` を一緒に書かないと、Excelで開いた時に値が表示されない場合あり。または、Excel側で再計算（CalcOnLoad）させる方法もある。
2. **数値フォーマット**: `cell.numFmt = '#,##0;[Red]▲#,##0';` でマイナス赤＋三角表示。
3. **マージセル**: `ws.mergeCells('A1:B1')`
4. **セル書式コピー**: テンプレを使う場合、行挿入時に書式を維持するためのコピー処理が必要。

## 月別シートの動的生成

`legacy` フォーマットでは、出力対象期間の月ごとにシートを作る：

- 単月指定 → 該当月のシート1枚
- 範囲指定 → 該当月分のシートを連続で作成
- 賞与計算用に夏・冬シートを別途用意するかは将来検討

## ファイル名

```typescript
function generateFileName(format: 'legacy' | 'simple', options): string {
  const today = format(new Date(), 'yyyyMMdd');
  if (format === 'legacy') {
    return `集計用_${options.reportMonth.replace('-', '')}_${today}.xlsx`;
    // 例: 集計用_202503_20260501.xlsx
  } else {
    return `邸別一覧_${options.from}_${options.to}_${today}.xlsx`;
  }
}
```

## ダウンロードのレスポンス

```typescript
// app/api/excel/export/route.ts
export async function POST(request: Request) {
  // ... 認証・バリデーション ...
  const buffer = await exportLegacy(orgId, options);
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}
```

## 既存テンプレートの扱い

[invoice-tool/template/集計用.xlsx](https://github.com/RIKU0804/invoice-tool/blob/main/template/) のテンプレを参考にするが、**TypeScript版では基本的にプログラムで生成**する。テンプレファイルの依存を持つと、Vercelデプロイ時のファイル配置が複雑になるため。

ただし、書式の細部（罫線、フォント、色）を正確に再現するのが難しい場合は、テンプレを `public/templates/` に置いてランタイムで読み込む選択肢もある。

## テスト

`tests/excel-exporter.test.ts`:

1. 18邸のデータで `legacy` フォーマット出力 → セル位置・数式が正しい
2. 25邸（>18）で動的に行が拡張される
3. シンプル一覧でヘッダー・データが正しい
4. 数式の結果がExcelで開いた時に正しく表示される（`result` プロパティ確認）
