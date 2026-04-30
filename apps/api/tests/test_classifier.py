"""
分類ロジックの単体テスト
03-business-logic.md の必須ケースを網羅
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from services.classifier import classify_and_aggregate


def _row(tei: str, koushu: str, bikou: str, zeinuki: int) -> dict:
    return {
        "邸名": tei,
        "契約NO": "TEST-001",
        "工種": koushu,
        "税抜金額": zeinuki,
        "消費税": 0,
        "税込金額": 0,
        "備考": bikou,
        "事業所": "TEST",
    }


def test_positive_amount_goes_to_sales():
    rows = [_row("西尾 友成", "木工事", "", 100000)]
    result = classify_and_aggregate(rows)
    assert len(result) == 1
    assert result[0].amount_sales == 100000
    assert result[0].amount_shaho == 0
    assert result[0].amount_seisanka == 0
    assert result[0].amount_materials == 0


def test_seisanka_shaho_goes_to_E():
    rows = [_row("田中 太郎", "防水(社保)", "生産課中口分", -50000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_shaho == 50000
    assert result[0].amount_seisanka == 0
    assert result[0].amount_materials == 0


def test_seisanka_non_shaho_goes_to_F():
    rows = [_row("田中 太郎", "防水", "生産課中口分", -30000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_seisanka == 30000
    assert result[0].amount_shaho == 0
    assert result[0].amount_materials == 0


def test_default_negative_goes_to_materials():
    rows = [_row("田中 太郎", "材料費", "", -20000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_materials == 20000
    assert result[0].amount_seisanka == 0
    assert result[0].amount_shaho == 0


def test_nakauchi_variation_is_seisanka():
    """「中口応援分」など中口プレフィックスも生産課扱い (v1.0.98〜)"""
    rows = [_row("山田 花子", "防水", "中口応援分", -15000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_seisanka == 15000


def test_nakauchi_shaho_variation():
    rows = [_row("山田 花子", "防水(社保)", "中口応援補填", -12000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_shaho == 12000


def test_gross_profit_calculation():
    rows = [
        _row("ABC邸", "木工事", "", 200000),
        _row("ABC邸", "材料費", "", -50000),
    ]
    result = classify_and_aggregate(rows)
    assert result[0].property_name == "ABC邸"
    assert result[0].amount_sales == 200000
    assert result[0].amount_materials == 50000
    assert result[0].gross_profit == 150000


def test_multiple_positive_amounts_summed():
    rows = [
        _row("XYZ邸", "木工事", "", 100000),
        _row("XYZ邸", "柱脚", "", 50000),
    ]
    result = classify_and_aggregate(rows)
    assert result[0].amount_sales == 150000


def test_skip_aggregate_rows():
    rows = [
        _row("計", "木工事", "", 999999),
        _row("合計", "木工事", "", 999999),
        _row("消費税対象外", "木工事", "", 999999),
    ]
    result = classify_and_aggregate(rows)
    assert len(result) == 0


def test_multiple_properties():
    rows = [
        _row("A邸", "木工事", "", 100000),
        _row("B邸", "木工事", "", 200000),
    ]
    result = classify_and_aggregate(rows)
    assert len(result) == 2
    names = {r.property_name for r in result}
    assert names == {"A邸", "B邸"}
