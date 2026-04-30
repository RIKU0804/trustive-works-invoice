"""
PDF parsing service — ported from invoice-tool/plumber_extractor.py
"""
import re
import tempfile
from typing import Optional

import pdfplumber


def extract_payment_date(pdf_path: str) -> Optional[str]:
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                # Strict pattern: 支払日 prefix
                m = re.search(r'支払日\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日', text)
                if m:
                    return f"{m.group(1)}年{m.group(2).zfill(2)}月{m.group(3).zfill(2)}日"
                # Fallback: garbled CJK encoding — match YYYY<any 1-3 chars>MM<any 1-3 chars>DD
                # within the first 500 chars (header area)
                head = text[:500]
                m2 = re.search(r'(20\d{2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})', head)
                if m2:
                    return f"{m2.group(1)}年{m2.group(2).zfill(2)}月{m2.group(3).zfill(2)}日"
    except Exception as e:
        print(f"[extract_payment_date] error: {e}")
    return None


def extract_totals(pdf_path: str) -> dict:
    result: dict = {"furikomi": None, "sousai": None}
    try:
        with pdfplumber.open(pdf_path) as pdf:
            target_page = None
            for page in pdf.pages:
                text = page.extract_text() or ""
                if ("合計" in text) and ("相殺" in text or "工事代" in text):
                    target_page = page
            if target_page is None:
                return result

            text = target_page.extract_text() or ""
            all_goukei = re.findall(r'合計\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', text)
            if all_goukei:
                result["furikomi"] = int(all_goukei[-1][2].replace(",", ""))

            m_sousai = re.search(
                r'＜相殺\s*計＞\s*([▲▽\-−]?[\d,]+)\s+([▲▽\-−]?[\d,]*)\s*([▲▽\-−]?[\d,]+)',
                text,
            )
            if m_sousai:
                result["sousai"] = _to_int_amount(m_sousai.group(3))
    except Exception as e:
        print(f"[extract_totals] error: {e}")
    return result


def extract_rows(pdf_path: str) -> Optional[list[dict]]:
    try:
        all_rows = []
        with pdfplumber.open(pdf_path) as pdf:
            any_text_page = False
            for page_num, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                if len(text.strip()) < 50:
                    continue
                any_text_page = True
                for table in page.extract_tables():
                    for row in table:
                        if not row or len(row) < 8:
                            continue
                        parsed = _parse_row(row)
                        if parsed:
                            all_rows.append(parsed)

            if not any_text_page:
                return None

        return all_rows if all_rows else None
    except Exception as e:
        print(f"[extract_rows] error: {e}")
        return None


def _parse_row(row: list) -> Optional[dict]:
    try:
        jigyosho, keiyaku_no, tei_mei, koushu, zeinuki, shohizei, zeikomi, bikou = row[:8]
        amount_before_tax = _parse_amount(zeinuki)
        if amount_before_tax is None:
            return None

        def s(v) -> str:
            return str(v).strip() if v is not None else ""

        return {
            "事業所": s(jigyosho),
            "契約NO": s(keiyaku_no),
            "邸名": s(tei_mei),
            "工種": s(koushu),
            "税抜金額": amount_before_tax,
            "消費税": _parse_amount(shohizei) or 0,
            "税込金額": _parse_amount(zeikomi) or 0,
            "備考": s(bikou),
        }
    except Exception:
        return None


def _parse_amount(s) -> Optional[int]:
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    is_negative = s.startswith(("▲", "-", "−"))
    clean = re.sub(r"[^\d]", "", s)
    if not clean:
        return None
    val = int(clean)
    return -val if is_negative else val


def _to_int_amount(s: str) -> int:
    s = s.strip()
    neg = s.startswith(("▲", "-", "−", "▽"))
    digits = re.sub(r'[^\d]', '', s)
    if not digits:
        return 0
    return -int(digits) if neg else int(digits)
