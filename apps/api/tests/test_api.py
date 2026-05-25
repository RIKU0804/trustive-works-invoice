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


# テスト用 fixed UUID (router の UUID 形式バリデーションを満たす)
TEST_ORG_ID = "11111111-1111-1111-1111-111111111111"
TEST_API_KEY = "test-key"


@pytest.fixture(scope="session")
def app_instance(tmp_path_factory):
    """API_KEY を環境変数経由で設定してから FastAPI app を import する。

    モジュールトップレベルで os.environ をいじって import するパターンは、
    テスト間の状態漏れ・順序依存・並列実行不能の温床なので fixture に閉じ込める。
    """
    # 環境変数を tests セッションスコープで確定させる
    prev = os.environ.get("API_KEY")
    os.environ["API_KEY"] = TEST_API_KEY
    try:
        # settings はモジュールロード時に評価されるため、既にロードされていれば上書きする
        from core.config import settings
        settings.api_key = TEST_API_KEY
        from main import app
        yield app
    finally:
        if prev is None:
            os.environ.pop("API_KEY", None)
        else:
            os.environ["API_KEY"] = prev


@pytest.fixture(scope="session")
def client(app_instance):
    return TestClient(app_instance)


@pytest.fixture(scope="session")
def settings_obj(app_instance):
    from core.config import settings
    return settings


HEADERS = {"X-API-Key": TEST_API_KEY, "X-Organization-Id": TEST_ORG_ID}


def _fake_pdf(pages: int = 1):
    """pdfplumber.open の戻り値を模した context manager。"""
    m = MagicMock()
    m.pages = [MagicMock() for _ in range(pages)]
    m.__enter__.return_value = m
    m.__exit__.return_value = False
    return m


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_parse_pdf_invalid_key(client):
    fake_pdf = io.BytesIO(b"%PDF-1.4 fake")
    res = client.post(
        "/pdf/parse",
        headers={"X-API-Key": "wrong-key", "X-Organization-Id": TEST_ORG_ID},
        files={"file": ("test.pdf", fake_pdf, "application/pdf")},
    )
    assert res.status_code == 401


def test_parse_pdf_rejects_invalid_org_id(client):
    """UUID 形式でない X-Organization-Id は 400 で拒否される (v1.1 ハードニング)。"""
    fake_pdf = io.BytesIO(b"%PDF-1.4 fake")
    res = client.post(
        "/pdf/parse",
        headers={"X-API-Key": TEST_API_KEY, "X-Organization-Id": "not-a-uuid"},
        files={"file": ("test.pdf", fake_pdf, "application/pdf")},
    )
    assert res.status_code == 400


def test_parse_pdf_rejects_non_pdf(client):
    res = client.post(
        "/pdf/parse",
        headers=HEADERS,
        files={"file": ("evil.pdf", io.BytesIO(b"<html>not a pdf</html>"), "application/pdf")},
    )
    assert res.status_code == 415


def test_parse_pdf_rejects_empty_file(client):
    res = client.post(
        "/pdf/parse",
        headers=HEADERS,
        files={"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")},
    )
    assert res.status_code == 400


def test_parse_pdf_rejects_oversize(client, settings_obj):
    too_big = b"%PDF-" + b"0" * (settings_obj.max_upload_bytes + 10)
    res = client.post(
        "/pdf/parse",
        headers=HEADERS,
        files={"file": ("big.pdf", io.BytesIO(too_big), "application/pdf")},
    )
    assert res.status_code == 413


def test_parse_pdf_success(client):
    mock_rows = [
        {"邸名": "西尾 友成", "契約NO": "001", "工種": "木工事", "税抜金額": 161028,
         "消費税": 16103, "税込金額": 177131, "備考": "", "事業所": "本社"},
    ]
    mock_totals = {
        "furikomi": 10933813,
        "sousai": 0,
        "pdf_koujidai_zeinuki": None,
        "pdf_koujidai_zeikomi": None,
    }

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


def test_parse_pdf_image_pdf_returns_422(client):
    with patch("routers.pdf.pdfplumber.open", return_value=_fake_pdf()), \
         patch("routers.pdf.extract_rows", return_value=None), \
         patch("routers.pdf.extract_totals", return_value={
             "furikomi": None, "sousai": None,
             "pdf_koujidai_zeinuki": None, "pdf_koujidai_zeikomi": None,
         }), \
         patch("routers.pdf.extract_payment_date", return_value=None):

        fake_pdf = io.BytesIO(b"%PDF-1.4 fake")
        res = client.post(
            "/pdf/parse",
            headers=HEADERS,
            files={"file": ("scan.pdf", fake_pdf, "application/pdf")},
        )

    assert res.status_code == 422
