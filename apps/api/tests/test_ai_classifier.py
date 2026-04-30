"""
AI 分類器のテスト。

httpx を直接モックして OpenRouter / Anthropic 両プロバイダのフォールバック挙動を検証。
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import MagicMock, patch

import pytest
import httpx

from services import ai_classifier
from services.classifier import classify_row


def _row_with_rule(work_type: str, note: str, amount: int) -> dict:
    """classify_row を通して信頼度付きの row を作る"""
    base = {"工種": work_type, "備考": note, "税抜金額": amount}
    rule = classify_row(base)
    return {
        **base,
        "邸名": "テスト邸",
        "契約NO": "C-1",
        "category": rule.category,
        "classification_confidence": rule.confidence,
    }


def _openrouter_response(content_text: str, prompt_tokens: int = 100, completion_tokens: int = 20) -> MagicMock:
    """OpenRouter の chat completions レスポンスを模擬"""
    res = MagicMock(spec=httpx.Response)
    res.status_code = 200
    res.raise_for_status = MagicMock()
    res.json.return_value = {
        "choices": [{"message": {"content": content_text}}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens},
    }
    return res


def _anthropic_response(text: str, input_tokens: int = 100, output_tokens: int = 20) -> MagicMock:
    res = MagicMock(spec=httpx.Response)
    res.status_code = 200
    res.raise_for_status = MagicMock()
    res.json.return_value = {
        "content": [{"type": "text", "text": text}],
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
    }
    return res


# ----- プロバイダ未設定 -----
def test_no_api_key_returns_rule_only():
    rows = [
        _row_with_rule("木工事", "", 100000),
        _row_with_rule("防水", "謎の表現", -10000),
    ]
    with patch.object(ai_classifier.settings, "openrouter_api_key", ""), \
         patch.object(ai_classifier.settings, "anthropic_api_key", ""):
        updated, records = ai_classifier.classify_low_confidence_rows(rows)

    assert len(updated) == 2
    assert all(r["classification_method"] == "rule" for r in updated)
    assert records == []


def test_high_confidence_rows_skip_ai():
    rows = [_row_with_rule("木工事", "", 100000)]
    with patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows(rows)

    assert len(records) == 0
    assert updated[0]["classification_method"] == "rule"
    mock_http.post.assert_not_called()


# ----- OpenRouter プロバイダ -----
def test_openrouter_low_confidence_row_classified():
    low_conf_row = _row_with_rule("防水", "応援補填", -10000)
    assert low_conf_row["classification_confidence"] < 0.7

    with patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _openrouter_response(
            '{"category":"seisanka","confidence":0.92,"reasoning":"応援補填は中口応援と同義"}',
            prompt_tokens=120,
            completion_tokens=30,
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low_conf_row])

    assert len(records) == 1
    assert records[0].error is None
    assert records[0].input_tokens == 120
    assert records[0].output_tokens == 30
    assert updated[0]["category"] == "seisanka"
    assert updated[0]["classification_method"] == "ai"
    assert updated[0]["classification_confidence"] == pytest.approx(0.92)
    # OpenRouter エンドポイントを叩いたか確認
    call_args = mock_http.post.call_args
    assert "openrouter.ai" in call_args.args[0]


def test_openrouter_error_falls_back_to_rule():
    low_conf_row = _row_with_rule("防水", "見たことない表現", -5000)
    with patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.side_effect = RuntimeError("API down")
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low_conf_row])

    assert len(records) == 1
    assert records[0].error is not None
    assert "API down" in records[0].error
    assert updated[0]["classification_method"] == "rule"
    assert updated[0]["category"] == low_conf_row["category"]


def test_openrouter_invalid_response_falls_back():
    low_conf_row = _row_with_rule("防水", "謎", -5000)
    with patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _openrouter_response("これはJSONじゃない")
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low_conf_row])

    assert records[0].error is not None
    assert updated[0]["classification_method"] == "rule"


def test_openrouter_markdown_code_fence_parsed():
    low_conf_row = _row_with_rule("防水", "なぞ", -1000)
    with patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _openrouter_response(
            '```json\n{"category":"material","confidence":0.6,"reasoning":"訂正分"}\n```'
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low_conf_row])

    assert records[0].error is None
    assert updated[0]["category"] == "material"
    assert updated[0]["classification_method"] == "ai"


def test_openrouter_invalid_category_falls_back():
    low_conf_row = _row_with_rule("防水", "謎", -1000)
    with patch.object(ai_classifier.settings, "openrouter_api_key", "fake-or-key"), \
         patch.object(ai_classifier.settings, "ai_provider", "openrouter"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _openrouter_response(
            '{"category":"unknown","confidence":0.9,"reasoning":""}'
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low_conf_row])

    assert records[0].error is not None
    assert updated[0]["classification_method"] == "rule"


# ----- Anthropic 直接プロバイダ -----
def test_anthropic_provider_works():
    """ai_provider=anthropic + anthropic_api_key 設定で Anthropic 直接エンドポイントが叩かれる"""
    low_conf_row = _row_with_rule("防水", "応援補填", -10000)
    with patch.object(ai_classifier.settings, "ai_provider", "anthropic"), \
         patch.object(ai_classifier.settings, "openrouter_api_key", ""), \
         patch.object(ai_classifier.settings, "anthropic_api_key", "fake-anthropic-key"), \
         patch("services.ai_classifier.httpx.Client") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.post.return_value = _anthropic_response(
            '{"category":"seisanka","confidence":0.85,"reasoning":"中口関連"}'
        )
        mock_client_cls.return_value.__enter__.return_value = mock_http
        updated, records = ai_classifier.classify_low_confidence_rows([low_conf_row])

    assert records[0].error is None
    assert updated[0]["category"] == "seisanka"
    call_args = mock_http.post.call_args
    assert "api.anthropic.com" in call_args.args[0]


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
