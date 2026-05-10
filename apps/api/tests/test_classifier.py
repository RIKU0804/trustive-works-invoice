"""
分類ロジックの単体テスト
03-business-logic.md の必須ケースを網羅
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from services.classifier import classify_and_aggregate


def _row(tei: str, koushu: str, bikou: str, zeinuki: int, shohizei: int = 0) -> dict:
    return {
        "邸名": tei,
        "契約NO": "TEST-001",
        "工種": koushu,
        "税抜金額": zeinuki,
        "消費税": shohizei,
        "税込金額": zeinuki + shohizei,
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


# ----- v1.2.4 立替金特別処理 -----

def test_tatekae_tracked_separately():
    """立替金行は amount_tatekae で別追跡される"""
    rows = [_row("共通原価邸", "立替金", "生産課エスポラス育成費", 110000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_tatekae == 110000
    # 売上(D)にも含まれる(後段の振込金額照合補正のため)
    assert result[0].amount_sales == 110000


def test_tatekae_with_normal_sales():
    """通常売上と立替金の混在: 別々に集計される"""
    rows = [
        _row("共通原価邸", "防水", "", 50000),
        _row("共通原価邸", "立替金", "生産課育成費", 110000),
    ]
    result = classify_and_aggregate(rows)
    assert result[0].amount_sales == 160000  # 50000 + 110000
    assert result[0].amount_tatekae == 110000  # 立替金のみ


def test_tatekae_default_zero():
    """立替金がない邸の amount_tatekae は 0"""
    rows = [_row("普通邸", "防水", "", 100000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_tatekae == 0


def test_tatekae_negative_goes_to_materials():
    """マイナスの立替金(レアケース)は materials へ"""
    rows = [_row("共通原価邸", "立替金", "", -10000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_tatekae == -10000
    assert result[0].amount_materials == 10000


# ----- 進化版要件 260510: カテゴリ別消費税の分離管理 -----

def test_sales_consumption_tax_aggregated():
    """売上行の消費税は amount_sales_tax に集計される"""
    rows = [_row("A邸", "防水(全)", "", 100000, 10000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_sales == 100000
    assert result[0].amount_sales_tax == 10000


def test_shaho_consumption_tax_aggregated():
    """社保行(マイナス)の消費税絶対値が amount_shaho_tax に集計される"""
    rows = [_row("A邸", "防水(社保)", "生産課中口分", -50000, -5000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_shaho == 50000
    assert result[0].amount_shaho_tax == 5000


def test_seisanka_consumption_tax_aggregated():
    """生産課行の消費税絶対値が amount_seisanka_tax に集計される"""
    rows = [_row("A邸", "防水(全)", "生産課中口分", -30000, -3000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_seisanka == 30000
    assert result[0].amount_seisanka_tax == 3000


def test_material_consumption_tax_aggregated():
    """材料費行の消費税絶対値が amount_materials_tax に集計される"""
    rows = [_row("A邸", "防水シート(相殺)", "", -20000, -2000)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_materials == 20000
    assert result[0].amount_materials_tax == 2000


def test_tatekae_has_zero_tax():
    """立替金は非課税のため消費税は 0 (D には含めるが D_tax には加えない)"""
    rows = [_row("共通原価邸", "立替金", "", 110000, 0)]
    result = classify_and_aggregate(rows)
    assert result[0].amount_sales == 110000
    assert result[0].amount_sales_tax == 0
    assert result[0].amount_tatekae == 110000


def test_consumption_tax_default_zero_when_missing():
    """消費税フィールドが None の行も 0 として扱う (後方互換)"""
    row = {
        "邸名": "A邸",
        "契約NO": "T-1",
        "工種": "防水(全)",
        "税抜金額": 100000,
        "消費税": None,
        "税込金額": 100000,
        "備考": "",
        "事業所": "TEST",
    }
    result = classify_and_aggregate([row])
    assert result[0].amount_sales == 100000
    assert result[0].amount_sales_tax == 0


def test_mixed_categories_tax_aggregated_correctly():
    """1邸に複数カテゴリが混在しても消費税が分離して集計される"""
    rows = [
        _row("A邸", "防水(全)", "", 100000, 10000),
        _row("A邸", "防水(社保)", "生産課中口分", -8000, -800),
        _row("A邸", "防水シート(相殺)", "", -50000, -5000),
    ]
    result = classify_and_aggregate(rows)
    assert result[0].amount_sales == 100000
    assert result[0].amount_sales_tax == 10000
    assert result[0].amount_shaho == 8000
    assert result[0].amount_shaho_tax == 800
    assert result[0].amount_materials == 50000
    assert result[0].amount_materials_tax == 5000
