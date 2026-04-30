# 既存invoice-toolの解析メモ

## リポジトリ
https://github.com/RIKU0804/invoice-tool

## 構成

| ファイル | 役割 | TS版での扱い |
|---|---|---|
| `gui.py` | customtkinterのデスクトップGUI | **不要**（Web UIで置換） |
| `plumber_extractor.py` | pdfplumberでPDF→明細rows抽出 | **TypeScriptに移植**（pdfjs-distベース） |
| `excel_writer.py` | 集計ロジック＋Excelテンプレ書込 | **集計部分はTS移植**、書込はExcelJSで再実装 |
| `config.py` | 分類ルール定義（ドキュメント用） | TSに移植 |
| `template/集計用.xlsx` | Excelテンプレート | プログラム生成 or `public/templates/` 配置 |
| `updater.py` | GitHub Releases経由の自動更新 | **不要**（Webは常に最新） |
| `invoice-tool.spec` | PyInstaller設定 | 不要 |

## config.py 抜粋

```python
"classification_rules": {
  "①税抜(D)": "プラス金額をすべて加算（社保プラス・柱脚含む）",
  "②社保(E)": "マイナス×工種が「防水(社保)」×備考に「生産課中口分」を含む → 絶対値",
  "③生産課(F)": "マイナス×社保以外×備考に「生産課中口分」を含む → 絶対値",
  "④材料費(G)": "防水シート(相殺) + 上記に当てはまらないマイナス → 絶対値",
}
```

→ TS版でもこのドキュメンテーションをそのまま `lib/pdf/classifier.ts` のJSDocに残す。

## plumber_extractor.py の主要関数

### `extract_payment_date(pdf_path) → "YYYY年MM月DD日"`

- 全ページから `支払日 YYYY年MM月DD日` の正規表現で1つだけ取る
- TS版: `04-pdf-parsing.md` の `extractPaymentDate()` 参照

### `extract_totals_and_snippet(pdf_path) → {furikomi, sousai, snippet_path}`

- 「合計 N N N」の最後のマッチから振込金額（税込）を取る
- 「＜相殺 計＞」セクションから税込相殺を取る
- 既存版はPDFの該当部分を画像スニペットとしても保存（UI上で根拠表示用）
- TS版: スニペット画像は不要（Web UIで該当部分にリンクすれば十分）

### `extract_with_pdfplumber(pdf_path) → {rows: [...]}`

- 全ページの `page.extract_tables()` でテーブル抽出
- `_parse_row()` で各行を `{事業所, 契約NO, 邸名, 工種, 税抜金額, 消費税, 税込金額, 備考}` に構造化
- ヘッダー行の自動検出は無く、`_parse_amount` で数値変換に失敗した行はスキップしている

### `_parse_amount(s) → int | None`

- `▲` `-` `−` のいずれかで始まればマイナス
- 数字以外を全部除去して `int()` 変換
- TS版: `04-pdf-parsing.md` の `parseAmount()` 参照

## excel_writer.py の主要関数

### `classify_and_aggregate(rows: list[dict]) → list[dict]`

**最重要関数**。これが振り分けロジックの核心。

```python
def classify_and_aggregate(rows):
    by_tei = defaultdict(lambda: {
        "邸名": "",
        "契約NO": set(),
        "工事名称": set(),
        "D_items": [],
        "E": 0,
        "F": 0,
        "G_items": [],
    })

    for row in rows:
        tei = row["邸名"]
        amount = int(round(float(row["税抜金額"])))
        koushu = row["工種"]
        bikou = row.get("備考", "")

        # スキップ判定
        if not tei or tei in ("計", "合計") or "消費税" in tei or "対象外" in tei:
            continue

        agg = by_tei[tei]
        agg["邸名"] = tei
        agg["契約NO"].add(row.get("契約NO", ""))

        # 工種から「防水」「柱脚」を抽出してwork_summaryに
        if "防水" in koushu: agg["工事名称"].add("防水")
        if "柱脚" in koushu: agg["工事名称"].add("柱脚")

        # 振り分け
        is_seisanka = ("生産課" in bikou) or ("中口" in bikou)
        is_shaho = "社保" in koushu

        if amount >= 0:
            agg["D_items"].append(amount)
        else:
            abs_amount = abs(amount)
            if is_seisanka and is_shaho:
                agg["E"] += abs_amount
            elif is_seisanka:
                agg["F"] += abs_amount
            else:
                agg["G_items"].append(abs_amount)

    return [...]
```

**注目ポイント**:
- `is_seisanka = ("生産課" in bikou) or ("中口" in bikou)` ← **ここがキー**。
  - コメント: 「pdfplumberが『生産課中口分』を『生産課』と『中口分』に分割するケース対応」
  - 「中口応援分」など中口プレフィックスを生産課判定に含める（依頼者指示）
- `D_items` `G_items` は配列で持っていて、後で `=A+B+C` の式として書き出している（粗利の精度確保のため）
- `E`, `F` は単純加算

### `write_to_template(...)`

- 既存テンプレ `集計用.xlsx` を読み込み or 既存outputがあればそれを開く
- 邸数に応じて行を動的にinsert/delete
- セル位置：データ5〜(4+n)行、合計行=(5+n)、班長集計=(sum_row+5)〜
- 既存ファイル(年次運用)対応のため、テンプレ状態か圧縮済み状態かを判別している
- TS版: ExcelJSで毎回新規生成する方が単純なので、年次運用は要件に応じて検討

### Excel書式の詳細

- 班長プルダウン: `'山本,熱田,安保'`
- 条件付き書式:
  - 班長未入力（K列空＋B列埋まり）→ 薄黄 (`#FFF9E6`)
  - 差額：±10円超 → 赤、以内 → 緑
  - 班長名: 山本=左寄せ緑、熱田=中央オレンジ、安保=右寄せ青
- セル書式: 数値は `#,##0;[Red]▲#,##0`
- 担当邸数集計: N3:O9に固定配置
- 振込金額照合: `sum_row + 13` から始まる8行のセクション

## 既存invoice-toolの「クセ」

実運用で発見されたクセ：

1. **「中口」表現の揺れ**: 「生産課中口分」「中口応援分」「中口分」など。`config.py` v1.0.98以降で `or "中口" in bikou` を追加して対応している。
2. **pdfplumberの分割癖**: 同じセル内のテキストが2つに分かれて抽出されることがある。
3. **▲記号のフォント問題**: 一部PDFでは`▲`が `▽` で来ることがある。
4. **インボイス端数**: 税込合計と明細合計が完全一致しないことがある（PDFの注釈にも明記）。許容差は±数円。

## 移植時の注意

### そのまま移植する部分
- `classify_and_aggregate()` のロジック → `lib/pdf/classifier.ts`
- `_parse_amount()` → `lib/pdf/parser.ts`
- 振り分けキーワード判定（`生産課`、`中口`、`社保`） → そのまま

### 変える部分
- pdfplumberの代わりに `pdfjs-dist` を使う（テキスト座標から自前で行を組み立てる必要あり）
- 既存テンプレへの上書きではなく、毎回新規生成（DBが正となる）
- Excel書式の細部はExcelJSで再実装

### 強化する部分（既存にない機能）
- 個別行のカテゴリ手動オーバーライド（UI上で）
- 過去データの再集計（property_linesから）
- 複数テナント対応
- ダッシュボード（既存はExcelのみ）
- 月次メモ
- 履歴管理

## 既存ロジックを TS で再現する際のテスト方針

P0 で**必ず**やること：

1. 既存ツールに同じPDFを通した結果を取っておく（依頼者から事前提供してもらう、またはGUIで実行してもらう）
2. TS版で同じPDFを処理して、邸ごとの①〜⑦が完全一致することを確認
3. 一致しない邸があれば、その行のロジックを精査

サンプル期待値は `sample-data.md` 参照。
