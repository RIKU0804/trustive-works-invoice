"""
AI 分類器のテスト (バッチ + キャッシュ + オプトイン)。

httpx を直接モックして OpenRouter / Anthropic 両プロバイダの挙動を検証。
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
from unittest.mock import MagicMock, patch

import pytest
import httpx

from services import ai_classifier
from services.classifier import classify_row


@pytest.fixture(autouse=True)
def _clear_cache():
    """各テストごとにプロセスキャッシュをクリア (テスト間汚染防止)。"""
    ai_classifier.reset_cache()
    yield
    ai_classifier.reset_cache()


def _row_with_rule(work_type: str, note: str, amount: int) -> dict:
    base = {"工種": work_type, "備考": note, "税抜金額": amount}
    rule = classify_row(base)
    return {
        **base,
        "邸名": "テスト邸",
        "契約NO": "C-1",
        "category": rule.category,
        "classification_confidence": rule.confidence,
    }


def _or_response(arr, prompt_tokens=100, completion_tokens=20) -> MagicMock:
    """OpenRouter chat completions レスポンス (content は JSON 配列文字列)。"""
    content = arr if isinstance(arr, str) else json.dumps(arr)
    res = MagicMock(spec=httpx.Response)
    res.status_code = 200
    res.raise_for_status = MagicMock()
    res.json.return_value = {
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens},
    }
    return res


def _anthropic_response(arr, input_tokens=100, output_tokens=20) -> MagicMock:
    content = arr if isinstance(arr, str) else json.dumps(arr)
    res = MagicMock(spec=httpx.Response)
    res.status_code = 200
    res.raise_for_status = MagicMock()
    res.json.return_value = {
        "content": [{"type": "text", "text": content}],
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
    }
    return res


def _summary(records):
    return next((r for r in records if r.line_index == -1), None)


def _row_records(records):
    return [r for r in records if r.line_index >= 0]


# ----- AI 無効 / キー未設定 -----
def test_ai_disabled_returns_rule_only():
    """ai_enabled=False ならキーがあっても AI を呼ばない (既定=コストゼロ)。"""
    rows = [_row_with_rule("防水", "謎の表現", -10000)]
    with patch.object(ai_classifier.settings, "ai_enabled", False), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows(rows)

    assert all(r["classification_method"] == "rule" for r in updated)
    assert records == []
    mock_http.post.assert_not_called()


def test_no_api_key_returns_rule_only():
    rows = [
        _row_with_rule("木工事", "", 100000),
        _row_with_rule("防水", "謎の表現", -10000),
    ]
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", ""), \
         patch.object(ai_classifier.settings, "anthropic_api_key", ""):
        updated, records = ai_classifier.classify_low_confidence_rows(rows)

    assert len(updated) == 2
    assert all(r["classification_method"] == "rule" for r in updated)
    assert records == []


def test_high_confidence_rows_skip_ai():
    rows = [_row_with_rule("木工事", "", 100000)]
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows(rows)

    assert records == []
    assert updated[0]["classification_method"] == "rule"
    mock_http.post.assert_not_called()


# ----- OpenRouter バッチ -----
def test_openrouter_batch_classified():
    low = _row_with_rule("防水", "応援補填", -10000)
    assert low["classification_confidence"] < 0.7

    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _or_response(
            [{"i": 0, "category": "seisanka", "confidence": 0.92, "reasoning": "応援補填=中口"}],
            prompt_tokens=120, completion_tokens=30,
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low])

    assert updated[0]["category"] == "seisanka"
    assert updated[0]["classification_method"] == "ai"
    assert updated[0]["classification_confidence"] == pytest.approx(0.92)
    # 1 回だけ呼ぶ (バッチ)
    assert mock_http.post.call_count == 1
    assert "openrouter.ai" in mock_http.post.call_args.args[0]
    # コストサマリ record にトークン実数が乗る
    summary = _summary(records)
    assert summary is not None and summary.error is None
    assert summary.input_tokens == 120 and summary.output_tokens == 30
    # 行別 record はトークン None (二重計上防止)
    rr = _row_records(records)
    assert rr and rr[0].ai_response["category"] == "seisanka"
    assert rr[0].input_tokens is None


def test_openrouter_error_falls_back_to_rule():
    low = _row_with_rule("防水", "見たことない表現", -5000)
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.side_effect = RuntimeError("API down")
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low])

    assert updated[0]["classification_method"] == "rule"
    assert updated[0]["category"] == low["category"]
    summary = _summary(records)
    assert summary is not None and summary.error and "API down" in summary.error


def test_openrouter_invalid_response_falls_back():
    low = _row_with_rule("防水", "謎", -5000)
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _or_response("これはJSONじゃない")
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low])

    assert updated[0]["classification_method"] == "rule"
    assert _summary(records).error is not None


def test_openrouter_markdown_code_fence_parsed():
    low = _row_with_rule("防水", "なぞ", -1000)
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _or_response(
            '```json\n[{"i":0,"category":"material","confidence":0.6,"reasoning":"訂正分"}]\n```'
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low])

    assert updated[0]["category"] == "material"
    assert updated[0]["classification_method"] == "ai"
    assert _summary(records).error is None


def test_openrouter_invalid_category_falls_back():
    low = _row_with_rule("防水", "謎", -1000)
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _or_response(
            [{"i": 0, "category": "unknown", "confidence": 0.9, "reasoning": ""}]
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low])

    assert updated[0]["classification_method"] == "rule"
    assert _summary(records).error is not None


# ----- 重複排除 & キャッシュ (コスト最適化の中核) -----
def test_duplicate_rows_single_batch_item():
    """同一 (工種,備考,符号) の複数行は 1 項目に集約され、1 回の呼び出しで済む。"""
    rows = [
        _row_with_rule("防水", "応援補填", -10000),
        _row_with_rule("防水", "応援補填", -10000),
        _row_with_rule("防水", "応援補填", -10000),
    ]
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _or_response(
            [{"i": 0, "category": "seisanka", "confidence": 0.9, "reasoning": "中口"}]
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows(rows)

    assert mock_http.post.call_count == 1  # 3 行でも 1 呼び出し
    assert all(u["category"] == "seisanka" for u in updated)
    assert all(u["classification_method"] == "ai" for u in updated)


def test_process_cache_avoids_second_call():
    """同じ (工種,備考,符号) は 2 回目以降キャッシュヒットで API を呼ばない。"""
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _or_response(
            [{"i": 0, "category": "material", "confidence": 0.8, "reasoning": "x"}]
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http

        u1, _ = ai_classifier.classify_low_confidence_rows(
            [_row_with_rule("防水", "繰り返す表現", -3000)])
        u2, r2 = ai_classifier.classify_low_confidence_rows(
            [_row_with_rule("防水", "繰り返す表現", -3000)])

    assert mock_http.post.call_count == 1  # 2 回目は API を呼ばない
    assert u1[0]["category"] == "material"
    assert u2[0]["category"] == "material"
    assert u2[0]["classification_method"] == "ai"
    assert _summary(r2) is None  # 2 回目はバッチ呼び出し自体が無い


# ----- Anthropic 直接プロバイダ -----
def test_anthropic_provider_works():
    low = _row_with_rule("防水", "応援補填", -10000)
    with patch.object(ai_classifier.settings, "ai_enabled", True), \
         patch.object(ai_classifier.settings, "ai_provider", "anthropic"), \
         patch.object(ai_classifier.settings, "openrouter_api_key", ""), \
         patch.object(ai_classifier.settings, "anthropic_api_key", "fake-anthropic-key"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _anthropic_response(
            [{"i": 0, "category": "seisanka", "confidence": 0.85, "reasoning": "中口関連"}]
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low])

    assert updated[0]["category"] == "seisanka"
    assert "api.anthropic.com" in mock_http.post.call_args.args[0]
    assert _summary(records).error is None


# ----- ルールベース信頼度付与のテスト -----
def test_rule_confidence_positive_amount_high():
    result = classify_row({"工種": "木工事", "備考": "", "税抜金額": 100000})
    assert result.category == "sales"
    assert result.confidence == 1.0


def test_rule_confidence_seisanka_high():
    result = classify_row({"工種": "防水", "備考": "中口応援分", "税抜金額": -50000})
    assert result.category == "seisanka"
    assert result.confidence == 1.0


def test_rule_confidence_shaho_high():
    result = classify_row({"工種": "防水(社保)", "備考": "生産課中口分", "税抜金額": -10000})
    assert result.category == "shaho"
    assert result.confidence == 1.0


def test_rule_confidence_unknown_note_low():
    result = classify_row({"工種": "防水", "備考": "応援補填", "税抜金額": -10000})
    assert result.category == "material"
    assert result.confidence < 0.7


def test_rule_confidence_empty_note_ambiguous():
    result = classify_row({"工種": "材料費", "備考": "", "税抜金額": -10000})
    assert result.confidence == 0.5
