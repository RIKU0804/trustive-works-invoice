# 03. 振り分けロジック仕様（最重要）

## このドキュメントの位置づけ

このプロジェクトの**コアアルゴリズム**を定義する。実装時は必ずこの仕様通りに作り、`reference/sample-data.md` の検証データで完全一致することを確認すること。

このロジックは既存の[invoice-tool](https://github.com/RIKU0804/invoice-tool)で実証済み・本番運用中のもの。1:1で TypeScript に移植する。

## 入力

PDFから抽出された明細行の配列：

```typescript
type PdfRow = {
  jigyosho: string;       // 事業所（例: 東京）
  contractNo: string;     // 契約NO（例: 10644CB-RA）
  propertyName: string;   // 邸名（例: 中川 明子）
  workType: string;       // 工種（例: 防水（社保））
  amountExclTax: number;  // 税抜金額（マイナスはそのまま負の数）
  consumptionTax: number; // 消費税
  amountInclTax: number;  // 税込金額
  note: string;           // 備考
};
```

## 出力

邸ごとに集計された結果：

```typescript
type AggregatedProperty = {
  propertyName: string;
  contractNo: string;
  workSummary: string;       // 工種サマリ（例: 防水・柱脚）
  amountSales: number;       // ①税抜
  amountShaho: number;       // ②社保
  amountSeisanka: number;    // ③生産課
  amountMaterial: number;    // ④材料費
  // ⑦粗利益 = sales - shaho - seisanka - material（呼び出し側で計算）
  lines: ClassifiedLine[];   // 元の明細行＋振り分け結果
};

type ClassifiedLine = PdfRow & {
  category: 'sales' | 'shaho' | 'seisanka' | 'material';
};
```

## 振り分けアルゴリズム

### 1. スキップ判定

以下の行は集計対象から除外する：

```typescript
function shouldSkip(row: PdfRow): boolean {
  const name = row.propertyName;
  if (!name) return true;
  if (name === '計' || name === '合計') return true;
  if (name.includes('消費税')) return true;
  if (name.includes('対象外')) return true;
  return false;
}
```

これはPDFの「＜工事代 計＞」「＜相殺 計＞」「合計」行を取り除くため。

### 2. 邸ごとにグループ化

`propertyName` をキーにグループ化する。`Map<string, PdfRow[]>` を作る。

### 3. 各邸内で振り分け

各邸の明細行に対して、以下のルールで `category` を判定する：

```typescript
function classify(row: PdfRow): 'sales' | 'shaho' | 'seisanka' | 'material' {
  const amount = row.amountExclTax;

  // ルール1: プラス金額はすべて① 税抜
  if (amount >= 0) {
    return 'sales';
  }

  // ルール2: マイナス金額の場合
  // 備考に「中口」を含むかどうかで分岐
  // （重要: 「生産課中口分」「中口応援」「中口応援分」など全パターンを「中口」だけで拾う）
  const isNakaguchi = row.note.includes('中口') || row.note.includes('生産課');
  // ↑ 既存invoice-toolでは「生産課」「中口」のORでマッチしている
  //   pdfplumberの抽出ブレ対策。両方を見る。

  if (isNakaguchi) {
    // 工種が「社保」を含めば②、それ以外は③
    if (row.workType.includes('社保')) {
      return 'shaho';
    }
    return 'seisanka';
  }

  // ルール3: 上記に該当しないマイナス → ④材料費
  // （防水シート相殺、単純訂正分などすべて）
  return 'material';
}
```

### 4. 集計

```typescript
function aggregate(rows: PdfRow[]): AggregatedProperty[] {
  const grouped = new Map<string, PdfRow[]>();
  for (const row of rows) {
    if (shouldSkip(row)) continue;
    const list = grouped.get(row.propertyName) ?? [];
    list.push(row);
    grouped.set(row.propertyName, list);
  }

  return Array.from(grouped.entries()).map(([name, propRows]) => {
    let sales = 0, shaho = 0, seisanka = 0, material = 0;
    const lines: ClassifiedLine[] = [];

    for (const row of propRows) {
      const category = classify(row);
      lines.push({ ...row, category });

      const abs = Math.abs(row.amountExclTax);
      if (category === 'sales')         sales += row.amountExclTax;  // 符号はそのまま（プラス）
      else if (category === 'shaho')    shaho += abs;
      else if (category === 'seisanka') seisanka += abs;
      else if (category === 'material') material += abs;
    }

    return {
      propertyName: name,
      contractNo: propRows[0].contractNo ?? '',
      workSummary: extractWorkSummary(propRows),
      amountSales: sales,
      amountShaho: shaho,
      amountSeisanka: seisanka,
      amountMaterial: material,
      lines,
    };
  });
}
```

### 5. 工種サマリの生成

`work_summary` は工種名の主要部分を抽出して連結する：

```typescript
function extractWorkSummary(rows: PdfRow[]): string {
  const bases = new Set<string>();
  for (const row of rows) {
    if (row.workType.includes('防水')) bases.add('防水');
    if (row.workType.includes('柱脚')) bases.add('柱脚');
  }
  return Array.from(bases).sort().join('・');
}
```

つまり「防水（全）」「防水（社保）」「柱脚（労）」から `防水・柱脚` を生成する。

## 検証ポイント

実装後、以下の検証を必ず通すこと。

### 単体テスト（必須）

`tests/classifier.test.ts` で以下のケースをカバー：

```typescript
describe('classify', () => {
  it('プラス金額は sales', () => {
    expect(classify({ amountExclTax: 100, note: '', workType: '防水（全）' }))
      .toBe('sales');
  });

  it('マイナス×中口×社保 → shaho', () => {
    expect(classify({
      amountExclTax: -2342, note: '生産課中口分', workType: '防水（社保）'
    })).toBe('shaho');
  });

  it('マイナス×中口×社保以外 → seisanka', () => {
    expect(classify({
      amountExclTax: -15000, note: '生産課中口分', workType: '防水（全）'
    })).toBe('seisanka');
  });

  it('マイナス×中口応援 → seisanka', () => {
    expect(classify({
      amountExclTax: -10000, note: '中口応援分', workType: '防水（全）'
    })).toBe('seisanka');
  });

  it('マイナス×防水シート相殺 → material', () => {
    expect(classify({
      amountExclTax: -276130, note: '2/18住べ納品書', workType: '防水シート（相殺）'
    })).toBe('material');
  });

  it('マイナス×単純訂正（備考に中口なし） → material', () => {
    expect(classify({
      amountExclTax: -23451, note: '', workType: '防水（全）'
    })).toBe('material');
  });
});
```

### 結合テスト（必須）

2024年12月分のPDF（`reference/sample-data.md` 参照）で、既存の手動集計済みExcelと**全邸の集計値が完全一致**すること。差異が出たら実装が間違っている。

サンプル期待値（一部）：

| 邸名 | ①税抜 | ②社保 | ③生産課 | ④材料費 | ⑦粗利益 |
|---|---|---|---|---|---|
| 西尾 友成 | 161,028 | 0 | 0 | 48,944 | 112,084 |
| 佐野 匡志 | 517,619 | 7,025 | 45,000 | 210,595 | 254,999 |
| 井伊 正己 | 808,388 | 2,342 | 15,000 | 380,866 | 410,180 |

詳細は `reference/sample-data.md`。

## 既存invoice-toolとの差分

既存のPython実装と機能的に1:1だが、TypeScript版で**改善する点**：

1. **手動オーバーライド機能**: UI上で個別の行の `category` を変更できるようにする（既存ツールには無い）。`property_lines.is_manually_overridden = true` で管理。
2. **再集計対応**: ロジック変更時に過去データを再集計できるようにする（`property_lines` を保持しているため可能）。
3. **エラーハンドリング**: 不正な金額・空の邸名などを早期に検出してUIにフィードバック。

## 例外パターンとして既知のもの

PDFを見て判断が必要な行が含まれる可能性。実装時は無視せず、UIに「未分類」として表示してユーザーに判断を委ねる：

- 「共通原価邸（東京リフォーム）」: 個別顧客でない。MVPでは普通の邸として扱うが、UIで判別できるよう表示。
- 「H363197-RZ 野村 匡（10691YB）エアコン脱着」のような**他邸への合算**: 邸名に括弧で他邸の契約NOが入る。MVPでは独立した邸として扱う。
- 退職年金掛金（▲15,000、保険料/浅井豊様・熱田龍太郎様・安保佑亮様）: 「対象外」スキップ判定でフィルタされる想定だが、PDFのフォーマットによっては漏れる可能性あり。テストで要確認。

## AI分類の確定フロー（P5追加予定）

1. PDFアップロード → AI分類実行（信頼度付き）
2. プレビュー画面でユーザーが確認
   - 高信頼度行：そのまま表示（変更任意）
   - 低信頼度行：ハイライト表示、手動修正を促す
3. ユーザーが「確定」ボタンを押す
   - 手動変更した行: `is_manually_overridden = true` で保存
   - AI判定のまま確定した行: `is_manually_overridden = false`
4. 確定後は分類の変更不可（監査ログに記録）

※確定前に全行を修正するのが正しいフロー（確定後修正は不可）
