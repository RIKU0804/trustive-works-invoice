"""
PDF parsing service — ported from invoice-tool/plumber_extractor.py v1.2.4

v1.2.4 features:
- Header-based column mapping (with positional fallback for header-less PDFs)
- Column count safety guard (no silent crashes)
- 邸名 carry-forward for continuation rows (PDFs that omit 邸名 on subsequent rows)
- ＜工事代 計＞ extraction from page text (税抜 + 税込)
- ＜相殺 計＞ 2-column format support (税抜=税込, 消費税列省略)

注: 抽出関数は「すでに開いた pdfplumber.PDF」を受け取る。
PDF を1回だけ開いて使い回すことでパースコスト/リソース圧を 1/3 にする。
"""
import logging
import re
from typing import Optional

import pdfplumber

logger = logging.getLogger(__name__)


# Column name aliases for flexible header detection
_COLUMN_ALIASES: dict[str, list[str]] = {
    "事業所":   ["事業所"],
    "契約NO":   ["契約NO", "契約No", "契約番号", "契約no"],
    "邸名":     ["邸名", "物件名"],
    "工種":     ["工種"],
    "税抜金額": ["税抜金額", "税抜", "金額(税抜)", "金額(税抜)"],
    "消費税":   ["消費税", "税額"],
    "税込金額": ["税込金額", "税込", "金額(税込)", "金額(税込)"],
    "備考":     ["備考", "摘要"],
}

# Default positional mapping (fallback when header is missing)
_DEFAULT_COL_MAP: dict[str, int] = {
    "事業所":   0,
    "契約NO":   1,
    "邸名":     2,
    "工種":     3,
    "税抜金額": 4,
    "消費税":   5,
    "税込金額": 6,
    "備考":     7,
}

# Required keys to identify a row as a header
_REQUIRED_HEADER_COLS = {"邸名", "工種", "税抜金額", "税込金額"}


def extract_payment_date(pdf: pdfplumber.PDF) -> Optional[str]:
    """Extract 支払日 from PDF in YYYY年MM月DD日 format.

    ベストエフォート: 失敗しても None を返す (支払日は補助情報のため)。
    """
    try:
        for page in pdf.pages:
            text = page.extract_text() or ""
            # Strict pattern: 支払日 prefix
            m = re.search(r'支払日\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日', text)
            if m:
                return f"{m.group(1)}年{m.group(2).zfill(2)}月{m.group(3).zfill(2)}日"
            # Fallback: garbled CJK encoding within first 500 chars
            head = text[:500]
            m2 = re.search(r'(20\d{2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})', head)
            if m2:
                return f"{m2.group(1)}年{m2.group(2).zfill(2)}月{m2.group(3).zfill(2)}日"
    except Exception:
        logger.exception("extract_payment_date failed")
    return None


def extract_totals(pdf: pdfplumber.PDF) -> dict:
    """Extract transfer amount and offset total from PDF.

    ベストエフォート: 失敗しても既定 dict を返す (照合用の補助情報のため)。

    Returns:
        {
            "furikomi": int|None,                  # 振込金額(税込) — last 合計 row's 税込
            "sousai":   int|None,                  # 税込相殺 — ＜相殺 計＞ 税込
            "pdf_koujidai_zeinuki": int|None,      # PDF記載の工事代計(税抜)
            "pdf_koujidai_zeikomi": int|None,      # PDF記載の工事代計(税込)
        }
    """
    result: dict = {
        "furikomi": None,
        "sousai": None,
        "pdf_koujidai_zeinuki": None,
        "pdf_koujidai_zeikomi": None,
    }
    try:
        target_page = None
        for page in pdf.pages:
            text = page.extract_text() or ""
            if ("合計" in text) and ("相殺" in text or "工事代" in text):
                target_page = page

            # ＜工事代 計＞ extraction can occur on any page
            m_koujidai = re.search(
                r'＜工事代\s*計＞\s*([\d,]+)\s+([\d,]+)\s+([\d,]+)', text
            )
            if m_koujidai and result["pdf_koujidai_zeinuki"] is None:
                result["pdf_koujidai_zeinuki"] = int(m_koujidai.group(1).replace(",", ""))
                result["pdf_koujidai_zeikomi"] = int(m_koujidai.group(3).replace(",", ""))

        if target_page is None:
            return result

        text = target_page.extract_text() or ""
        all_goukei = re.findall(r'合計\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', text)
        if all_goukei:
            result["furikomi"] = int(all_goukei[-1][2].replace(",", ""))

        # ＜相殺 計＞: 2 formats supported
        #   3-col: ＜相殺 計＞ -15,000 0 -15,000  (税抜 消費税 税込)
        #   2-col: ＜相殺 計＞ -718,450 -718,450 (税抜=税込, 消費税列省略)
        # Take the LAST number as 税込.
        m_sousai = re.search(
            r'＜相殺\s*計＞\s*([▲▽\-−]?[\d,]+)(?:\s+([▲▽\-−]?[\d,]+))?(?:\s+([▲▽\-−]?[\d,]+))?',
            text,
        )
        if m_sousai:
            nums = [g for g in m_sousai.groups() if g]
            if nums:
                result["sousai"] = _to_int_amount(nums[-1])
    except Exception:
        logger.exception("extract_totals failed")
    return result


def extract_rows(pdf: pdfplumber.PDF) -> Optional[list[dict]]:
    """Extract detail rows from PDF.

    Returns list of row dicts with keys:
      事業所, 契約NO, 邸名, 工種, 税抜金額, 消費税, 税込金額, 備考
    or None if the PDF has no extractable text (e.g., image/scanned PDF).

    重要: 「テキストが取れない (画像PDF)」場合のみ None を返す。
    パーサ自体が想定外の例外で落ちた場合は握りつぶさず再送出し、
    呼び出し側が 500 として扱えるようにする (データ欠損の隠蔽防止)。
    """
    try:
        all_rows: list[dict] = []

        any_text_page = False
        for page in pdf.pages:
            text = page.extract_text() or ""
            if len(text.strip()) < 50:
                continue
            any_text_page = True

            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue

                active_col_map: dict[str, int] = _DEFAULT_COL_MAP
                start_idx = 0
                detected = _detect_column_map(table[0])
                if detected is not None:
                    active_col_map = detected
                    start_idx = 1  # skip header row

                max_idx = max(active_col_map.values())
                for row in table[start_idx:]:
                    if not row:
                        continue
                    if len(row) <= max_idx:
                        logger.debug(
                            "skip insufficient columns: expected>=%d actual=%d",
                            max_idx + 1, len(row),
                        )
                        continue

                    parsed = _parse_row_mapped(row, active_col_map)
                    if parsed:
                        all_rows.append(parsed)

        if not any_text_page:
            return None

        if not all_rows:
            return None

        # 邸名 carry-forward:
        # PDFs sometimes only write 邸名 on the first row of a property's group.
        # pdfplumber returns empty 邸名 for subsequent rows. Propagate the last
        # valid 邸名 only when the continuation row plausibly belongs to the same
        # group: its 工種 must not be a summary (＜…＞) row, and its 契約NO must
        # be empty or match the last valid row's 契約NO (別契約への誤帰属を防止)。
        last_valid_tei = ""
        last_valid_contract = ""
        for row in all_rows:
            tei = row["邸名"]
            if tei:
                last_valid_tei = tei
                last_valid_contract = row.get("契約NO", "")
                continue
            if not (last_valid_tei and row["工種"] and not row["工種"].startswith("＜")):
                continue
            row_contract = row.get("契約NO", "")
            if row_contract and row_contract != last_valid_contract:
                # 契約NO が変わっている → 別グループの可能性が高いので引き継がない
                logger.warning(
                    "邸名 carry-forward skipped: contract changed (%r != %r)",
                    row_contract, last_valid_contract,
                )
                continue
            row["邸名"] = last_valid_tei

        return all_rows

    except Exception:
        # 想定外のパース失敗は握りつぶさない (画像PDFの 422 と区別する)
        logger.exception("extract_rows crashed unexpectedly")
        raise


def _detect_column_map(row: list) -> Optional[dict[str, int]]:
    """Detect a header row and return column mapping.

    Returns None if the row doesn't appear to be a header.
    """
    def _norm(v: object) -> str:
        return str(v).strip() if v is not None else ""

    cells = [_norm(c) for c in row]

    col_map: dict[str, int] = {}
    for canonical, aliases in _COLUMN_ALIASES.items():
        for i, cell in enumerate(cells):
            if cell in aliases:
                col_map[canonical] = i
                break

    if _REQUIRED_HEADER_COLS.issubset(col_map.keys()):
        return col_map
    return None


def _cell(row: list, col_map: dict[str, int], key: str) -> object:
    """Get a cell from a row using the column map. Returns None if out of range."""
    idx = col_map.get(key)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def _parse_row_mapped(row: list, col_map: dict[str, int]) -> Optional[dict]:
    """Parse a row using the given column map (header-detected or positional)."""
    def _s(v: object) -> str:
        return str(v).strip() if v is not None else ""

    try:
        zeinuki_val = _parse_amount(_cell(row, col_map, "税抜金額"))
        if zeinuki_val is None:
            return None

        return {
            "事業所":   _s(_cell(row, col_map, "事業所")),
            "契約NO":   _s(_cell(row, col_map, "契約NO")),
            "邸名":     _s(_cell(row, col_map, "邸名")),
            "工種":     _s(_cell(row, col_map, "工種")),
            "税抜金額": zeinuki_val,
            "消費税":   _parse_amount(_cell(row, col_map, "消費税")) or 0,
            "税込金額": _parse_amount(_cell(row, col_map, "税込金額")) or 0,
            "備考":     _s(_cell(row, col_map, "備考")),
        }
    except Exception as e:
        logger.debug("row parse failed: %s row=%r", e, row)
        return None


def _parse_amount(s: object) -> Optional[int]:
    """Parse a Japanese amount string.

    負数表現に対応:
      - 先頭の ▲ / - / − / ▽
      - 会計式の括弧囲み  (1,000) / （1,000）
      - 末尾マイナス       1,000-
    """
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    is_negative = (
        s.startswith(("▲", "-", "−", "▽"))
        or s.endswith("-")
        or ((s.startswith("(") or s.startswith("（")) and (s.endswith(")") or s.endswith("）")))
    )
    clean = re.sub(r"[^\d]", "", s)
    if not clean:
        return None
    val = int(clean)
    return -val if is_negative else val


def _to_int_amount(s: str) -> int:
    """Convert amount string to int (with sign). Returns 0 on parse failure."""
    s = s.strip()
    neg = s.startswith(("▲", "-", "−", "▽"))
    digits = re.sub(r'[^\d]', '', s)
    if not digits:
        return 0
    return -int(digits) if neg else int(digits)
