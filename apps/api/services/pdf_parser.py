"""
PDF parsing service — ported from invoice-tool/plumber_extractor.py v1.2.4

v1.2.4 features:
- Header-based column mapping (with positional fallback for header-less PDFs)
- Column count safety guard (no silent crashes)
- 邸名 carry-forward for continuation rows (PDFs that omit 邸名 on subsequent rows)
- ＜工事代 計＞ extraction from page text (税抜 + 税込)
- ＜相殺 計＞ 2-column format support (税抜=税込, 消費税列省略)
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


def extract_payment_date(pdf_path: str) -> Optional[str]:
    """Extract 支払日 from PDF in YYYY年MM月DD日 format."""
    try:
        with pdfplumber.open(pdf_path) as pdf:
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
    except Exception as e:
        logger.warning("extract_payment_date error: %s", e)
    return None


def extract_totals(pdf_path: str) -> dict:
    """Extract transfer amount and offset total from PDF.

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
        with pdfplumber.open(pdf_path) as pdf:
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
    except Exception as e:
        logger.warning("extract_totals error: %s", e)
    return result


def extract_rows(pdf_path: str) -> Optional[list[dict]]:
    """Extract detail rows from PDF.

    Returns list of row dicts with keys:
      事業所, 契約NO, 邸名, 工種, 税抜金額, 消費税, 税込金額, 備考
    or None if extraction failed (e.g., image PDF).
    """
    try:
        all_rows: list[dict] = []

        with pdfplumber.open(pdf_path) as pdf:
            any_text_page = False
            for page_num, page in enumerate(pdf.pages, start=1):
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
        # valid 邸名 for non-summary rows (those with 工種 not starting with ＜).
        last_valid_tei = ""
        for row in all_rows:
            tei = row["邸名"]
            if tei:
                last_valid_tei = tei
            elif last_valid_tei and row["工種"] and not row["工種"].startswith("＜"):
                row["邸名"] = last_valid_tei

        return all_rows

    except Exception as e:
        logger.warning("extract_rows error: %s", e)
        return None


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
    """Parse a Japanese amount string (with ▲, -, − as negative prefix)."""
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    is_negative = s.startswith("▲") or s.startswith("-") or s.startswith("−")
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
