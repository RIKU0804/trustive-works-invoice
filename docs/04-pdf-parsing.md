# 04. PDFパース仕様（pdfplumber使用）

## 入力PDFの構造

旭化成ホームズコンストラクション発行の支払い通知書（テキスト選択可能なPDF、画像PDFは対象外）。

### ヘッダー部分（ページ1）
- 作成日（例: 2025年03月10日）
- 登録番号（インボイス）
- 発行元・宛先住所
- **支払日**（例: 2025年03月20日） ← 抽出必須
- 表ヘッダー: 事業所 / 契約NO / 邸名 / 工種 / 税抜金額 / 消費税 / 税込金額 / 備考

### 明細部分（複数ページ）
邸ごとに複数の工種行が並ぶ。1邸あたり3〜15行程度。

### 末尾（最終ページ）
- ＜工事代 計＞ 8,386,458 / 838,646 / 9,225,104
- ＜相殺 計＞ ▲15,000 / 0 / ▲15,000（退職年金掛金）
- 合計 8,371,458 / 838,646 / 9,210,104 ← **この税込合計が振込金額**

## 抽出すべき情報

| 項目 | 用途 |
|---|---|
| 明細行（全ページ） | 集計のベース |
| 支払日 | `payment_notices.payment_date` |
| 工事代計（税抜・税込） | 検証用 |
| 振込金額（税込合計） | 振込照合 |
| 税込相殺 | 振込照合 |

## 実装：pdfplumber使用

既存invoice-toolの `plumber_extractor.py` をベースに、Pythonサービスとして再構築する。

```python
# apps/api/services/pdf_parser.py
import pdfplumber
import re
from typing import Optional
from schemas.models import PdfRow, ParseResult


def parse_pdf(file_path: str) -> ParseResult:
    """PDFをパースして構造化データを返す"""
    rows = []
    payment_date = None
    transfer_amount = None
    offset_incl_tax = None
    construction_total = None
    
    with pdfplumber.open(file_path) as pdf:
        all_text = ""
        for page_num, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            all_text += "\n" + text
            
            # ページ1から支払日を抽出
            if page_num == 1 and payment_date is None:
                payment_date = extract_payment_date(text)
            
            # テーブル抽出
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if not row or len(row) < 8:
                        continue
                    parsed = parse_row(row)
                    if parsed and not is_skip_row(parsed):
                        rows.append(parsed)
        
        # 末尾の合計値を取得
        transfer_amount, offset_incl_tax = extract_totals(all_text)
        construction_total = extract_construction_total(all_text)
    
    return ParseResult(
        rows=rows,
        payment_date=payment_date,
        transfer_amount=transfer_amount,
        offset_incl_tax=offset_incl_tax,
        construction_total=construction_total,
    )


def parse_row(row: list) -> Optional[PdfRow]:
    """1行のセル配列を構造化"""
    try:
        jigyosho, contract_no, property_name, work_type, zeinuki, tax, zeikomi, note = row[:8]
        
        amount = parse_amount(zeinuki)
        if amount is None:
            return None
        
        return PdfRow(
            jigyosho=str(jigyosho or "").strip(),
            contract_no=str(contract_no or "").strip(),
            property_name=normalize_name(property_name),
            work_type=normalize_work_type(work_type),
            amount_excl_tax=amount,
            consumption_tax=parse_amount(tax) or 0,
            amount_incl_tax=parse_amount(zeikomi) or 0,
            note=str(note or "").strip(),
        )
    except Exception as e:
        print(f"[parse_row] failed: {e}, row={row}")
        return None


def parse_amount(s) -> Optional[int]:
    """金額文字列を整数に変換（▲・−をマイナスとして扱う）"""
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    is_negative = s.startswith(("▲", "▽", "-", "−"))
    digits = re.sub(r"[^\d]", "", s)
    if not digits:
        return None
    val = int(digits)
    return -val if is_negative else val


def normalize_name(s) -> str:
    """邸名を正規化（全角・半角スペースを単一の半角スペースに）"""
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s).strip())


def normalize_work_type(s) -> str:
    """工種名を正規化（セル内改行を除去）"""
    if s is None:
        return ""
    return str(s).replace("\n", "").strip()


def is_skip_row(row: PdfRow) -> bool:
    """集計対象外の行を除外"""
    name = row.property_name
    if not name:
        return True
    if name in ("計", "合計"):
        return True
    if "消費税" in name or "対象外" in name:
        return True
    return False


def extract_payment_date(text: str) -> Optional[str]:
    """支払日を YYYY-MM-DD 形式で抽出"""
    m = re.search(r'支払日\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日', text)
    if not m:
        return None
    y, mo, d = m.groups()
    return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"


def extract_totals(text: str) -> tuple[Optional[int], Optional[int]]:
    """振込金額（税込合計）と税込相殺を抽出"""
    # 「合計 N N N」の最後のマッチを使う
    matches = re.findall(r'合計\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', text)
    transfer_amount = None
    if matches:
        last = matches[-1]
        transfer_amount = int(last[2].replace(",", ""))
    
    # 「＜相殺 計＞」の税込相殺
    m_sousai = re.search(
        r'＜相殺\s*計＞\s*([▲▽\-−]?[\d,]+)\s+\S*\s+([▲▽\-−]?[\d,]+)',
        text,
    )
    offset_incl_tax = parse_amount(m_sousai.group(2)) if m_sousai else None
    
    return transfer_amount, offset_incl_tax


def extract_construction_total(text: str) -> Optional[int]:
    """＜工事代 計＞の税抜金額を取得"""
    m = re.search(r'＜工事代\s*計＞\s*([\d,]+)', text)
    if not m:
        return None
    return int(m.group(1).replace(",", ""))
```

## Pydanticモデル

```python
# apps/api/schemas/models.py
from pydantic import BaseModel
from typing import Optional, Literal


class PdfRow(BaseModel):
    jigyosho: str
    contract_no: str
    property_name: str
    work_type: str
    amount_excl_tax: int
    consumption_tax: int
    amount_incl_tax: int
    note: str


class ParseResult(BaseModel):
    rows: list[PdfRow]
    payment_date: Optional[str] = None
    transfer_amount: Optional[int] = None
    offset_incl_tax: Optional[int] = None
    construction_total: Optional[int] = None


Category = Literal["sales", "shaho", "seisanka", "material"]
Confidence = Literal["high", "medium", "low", "needs_review"]


class ClassificationResult(BaseModel):
    category: Category
    confidence: Confidence
    source: str  # 'rule' | 'ai' | 'rule+ai'
    rule_predicted: Optional[Category] = None
    ai_reason: Optional[str] = None


class AggregatedProperty(BaseModel):
    property_name: str
    contract_no: str
    work_summary: str
    amount_sales: int
    amount_shaho: int
    amount_seisanka: int
    amount_material: int
    lines: list  # ClassifiedLine（PdfRow + classification）
```

## FastAPIエンドポイント

```python
# apps/api/routers/pdf.py
from fastapi import APIRouter, UploadFile, File, Header, HTTPException
import tempfile
from services.pdf_parser import parse_pdf
from services.classifier import aggregate_with_classification
from core.auth import verify_api_key

router = APIRouter(prefix="/pdf", tags=["pdf"])


@router.post("/parse")
async def parse_pdf_endpoint(
    file: UploadFile = File(...),
    organization_id: str = Header(..., alias="X-Organization-Id"),
    api_key: str = Header(..., alias="X-API-Key"),
):
    verify_api_key(api_key)
    
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "PDF以外のファイルは未対応")
    
    # 一時ファイルに保存してパース
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    parse_result = parse_pdf(tmp_path)
    
    # 振り分け（AI込み）
    aggregated = await aggregate_with_classification(
        parse_result.rows, organization_id
    )
    
    return {
        "payment_date": parse_result.payment_date,
        "transfer_amount": parse_result.transfer_amount,
        "offset_incl_tax": parse_result.offset_incl_tax,
        "construction_total": parse_result.construction_total,
        "properties": aggregated,
    }
```

## 重要な注意点

1. **セル内改行**: 工種名に改行が入る場合あり（例: `防水シート（相\n殺）`）。`normalize_work_type` で除去。
2. **全角スペースの混在**: 邸名は半角・全角スペースが混在。`normalize_name` で正規化。
3. **▲記号**: PDFによっては `▲` `▽` `-` `−` のいずれか。すべてマイナスとして扱う。
4. **複数ページ対応**: ヘッダー行は2ページ目以降にも繰り返し出現するので、`is_skip_row` で除外。
5. **テキスト位置の変動**: pdfplumberの `extract_tables()` は基本的に堅牢だが、PDFフォーマットの変更があると壊れる可能性。`reference/sample-data.md` の期待値で検証。

## エラーハンドリング

| ケース | 検出方法 | 処理 |
|---|---|---|
| 画像PDF | テキスト長 < 50 | UIに「画像PDFは未対応」と表示 |
| フォーマット違い | 期待行数の半分以下 | UIに「想定外のフォーマット」エラー |
| 行解析失敗 | parse_rowが None | 該当行スキップしてログ |
| 合計値不一致 | 工事代計と明細合計の差が大きい | UIに警告（インボイス端数±数円は許容） |

## テスト戦略

### サンプルPDFを使った結合テスト

`tests/fixtures/` に置く（gitignore登録）：
- `2025年1月支払通知書.pdf`（→ 2024年12月分の集計）
- `2025年2月支払通知書.pdf`
- `2025年3月支払通知書.pdf`

```python
# apps/api/tests/test_parser.py
import pytest
from services.pdf_parser import parse_pdf

def test_parse_2025_01_pdf():
    result = parse_pdf("tests/fixtures/2025年1月支払通知書.pdf")
    
    assert result.payment_date == "2025-01-20"
    assert result.transfer_amount == 10_933_813
    assert len(result.rows) > 80  # 18邸×複数行
    
    # 西尾 友成の行が存在
    nishio_rows = [r for r in result.rows if "西尾" in r.property_name]
    assert len(nishio_rows) >= 5
```

詳細な期待値は `reference/sample-data.md` 参照。
