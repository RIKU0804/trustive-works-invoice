"""
FastAPI エンドポイントの結合テスト
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import io
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

os.environ["API_KEY"] = "test-key"
from core.config import settings
settings.api_key = "test-key"  # 既にロード済みでも上書き (テスト順序依存を排除)
from main import app

client = TestClient(app)
HEADERS = {"X-API-Key": "test-key", "X-Organization-Id": "org-test"}


def _fake_pdf(pages: int = 1):
    """pdfplumber.open の戻り値を模した context manager。"""
    m = MagicMock()
    m.pages = [MagicMock() for _ in range(pages)]
    m.__enter__.return_value = m
    m.__exit__.return_value = False
    return m


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_parse_pdf_invalid_key():
    fake_pdf = io.BytesIO(b"%PDF-1.4 fake")
    res = client.post(
        "/pdf/parse",
        headers={"X-API-Key": "wrong-key", "X-Organization-Id": "org-test"},
        files={"file": ("test.pdf", fake_pdf, "application/pdf")},
    )
    assert res.status_code == 401


def test_parse_pdf_rejects_non_pdf():
    res = client.post(
        "/pdf/parse",
        headers=HEADERS,
        files={"file": ("evil.pdf", io.BytesIO(b"<html>not a pdf</html>"), "application/pdf")},
    )
    assert res.status_code == 415


def test_parse_pdf_rejects_empty_file():
    res = client.post(
        "/pdf/parse",
        headers=HEADERS,
        files={"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")},
    )
    assert res.status_code == 400


def test_parse_pdf_rejects_oversize():
    too_big = b"%PDF-" + b"0" * (settings.max_upload_bytes + 10)
    res = client.post(
        "/pdf/parse",
        headers=HEADERS,
        files={"file": ("big.pdf", io.BytesIO(too_big), "application/pdf")},
    )
    assert res.status_code == 413


def test_parse_pdf_success():
    mock_rows = [
        {"邸名": "西尾 友成", "契約NO": "001", "工種": "木工事", "税抜金額": 161028,
         "消費税": 16103, "税込金額": 177131, "備考": "", "事業所": "本社"},
    ]
    mock_totals = {"furikomi": 10933813, "sousai": 0}

    with patch("routers.pdf.pdfplumber.open", return_value=_fake_pdf()), \
         patch("routers.pdf.extract_rows", return_value=mock_rows), \
         patch("routers.pdf.extract_totals", return_value=mock_totals), \
         patch("routers.pdf.extract_payment_date", return_value="2025年01月20日"):

        fake_pdf = io.BytesIO(b"%PDF-1.4 fake")
        res = client.post(
            "/pdf/parse",
            headers=HEADERS,
            files={"file": ("test.pdf", fake_pdf, "application/pdf")},
        )

    assert res.status_code == 200
    data = res.json()
    assert data["payment_date"] == "2025年01月20日"
    assert data["transfer_amount"] == 10933813
    assert len(data["properties"]) == 1
    assert data["properties"][0]["property_name"] == "西尾 友成"
    assert data["properties"][0]["amount_sales"] == 161028


def test_parse_pdf_image_pdf_returns_422():
    with patch("routers.pdf.pdfplumber.open", return_value=_fake_pdf()), \
         patch("routers.pdf.extract_rows", return_value=None), \
         patch("routers.pdf.extract_totals", return_value={"furikomi": None, "sousai": None}), \
         patch("routers.pdf.extract_payment_date", return_value=None):

        fake_pdf = io.BytesIO(b"%PDF-1.4 fake")
        res = client.post(
            "/pdf/parse",
            headers=HEADERS,
            files={"file": ("scan.pdf", fake_pdf, "application/pdf")},
        )

    assert res.status_code == 422
