"""
Classification and aggregation service.

ルールベース分類 + 信頼度スコアを各行に付与する。
信頼度が低い行は AI 分類器（services.ai_classifier）で再分類される想定。
"""
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal, Optional

from schemas.models import AggregatedProperty


# ----- 定数 -----
KNOWN_NAKAUCHI_KEYWORDS = ("生産課", "中口")
SHAHO_KEYWORD = "社保"
KNOWN_MATERIAL_PATTERNS = ("防水シート", "相殺")
AGGREGATE_TEI_TOKENS = ("計", "合計", "消費税", "対象外")

CONFIDENCE_HIGH = 1.0
CONFIDENCE_MEDIUM = 0.7
CONFIDENCE_LOW_AMBIGUOUS = 0.5
CONFIDENCE_FALLBACK = 0.3

Category = Literal["sales", "shaho", "seisanka", "material"]


@dataclass(frozen=True)
class RuleResult:
    """単一行に対するルールベース分類の結果"""
    category: Category
    confidence: float


def is_aggregate_row(tei: str) -> bool:
    """合計行・消費税対象外などの集計用ダミー行を弾く"""
    if not tei:
        return True
    if tei in ("計", "合計"):
        return True
    return any(tok in tei for tok in ("消費税", "対象外"))


def classify_row(row: dict) -> RuleResult:
    """1 行をルールベースで分類し、信頼度スコアを付与する。

    - 明確なルールヒット（社保・中口/生産課キーワードあり）→ 1.0
    - あいまいなマイナス行（既知キーワードはあるが弱め）→ 0.5
    - 既知キーワードなしマイナス → 0.3 (フォールバック → AI 再分類対象)
    - プラス → 1.0 (sales 確定)
    """
    work_type = row.get("工種", "") or ""
    note = row.get("備考", "") or ""

    try:
        amount = int(round(float(row.get("税抜金額", 0))))
    except (TypeError, ValueError):
        amount = 0

    is_seisanka = any(kw in note for kw in KNOWN_NAKAUCHI_KEYWORDS)
    is_shaho = SHAHO_KEYWORD in work_type

    # プラス金額は売上で確定（強いルール）
    if amount >= 0:
        return RuleResult(category="sales", confidence=CONFIDENCE_HIGH)

    # マイナス金額の分岐
    if is_seisanka and is_shaho:
        return RuleResult(category="shaho", confidence=CONFIDENCE_HIGH)

    if is_seisanka:
        return RuleResult(category="seisanka", confidence=CONFIDENCE_HIGH)

    # 既知の材料費パターン（防水シート相殺など）
    if all(p in work_type for p in KNOWN_MATERIAL_PATTERNS):
        return RuleResult(category="material", confidence=CONFIDENCE_HIGH)

    # 備考が空 or 既知キーワード非該当 → AI に再分類してもらう余地あり
    note_stripped = note.strip()
    if not note_stripped:
        # 備考なしの単純訂正は「材料費だろう」とラベルしつつ低信頼
        return RuleResult(category="material", confidence=CONFIDENCE_LOW_AMBIGUOUS)

    # 既知キーワードのいずれかが note にあるが社保/生産課ではない（=見慣れない表現）
    return RuleResult(category="material", confidence=CONFIDENCE_FALLBACK)


def aggregate_classified_lines(lines: list[dict]) -> list[AggregatedProperty]:
    """分類済みの行を邸名ごとに集計する。

    各 dict は以下のキーを持つ想定:
      - 邸名, 契約NO, 工種, 税抜金額, 備考
      - category: 'sales' | 'shaho' | 'seisanka' | 'material'
    """
    by_tei: dict = defaultdict(lambda: {
        "邸名": "",
        "契約NO": set(),
        "工事名称": set(),
        "D_items": [],
        "E": 0,
        "F": 0,
        "G_items": [],
    })

    for row in lines:
        tei = row.get("邸名", "")
        if is_aggregate_row(tei):
            continue

        try:
            amount = int(round(float(row.get("税抜金額", 0))))
        except (TypeError, ValueError):
            continue

        agg = by_tei[tei]
        agg["邸名"] = tei
        agg["契約NO"].add(row.get("契約NO", ""))

        base_name = _extract_koji_base(row.get("工種", ""))
        if base_name:
            agg["工事名称"].add(base_name)

        category = row.get("category", "material")
        abs_amount = abs(amount)

        if category == "sales":
            agg["D_items"].append(amount if amount >= 0 else abs_amount)
        elif category == "shaho":
            agg["E"] += abs_amount
        elif category == "seisanka":
            agg["F"] += abs_amount
        else:  # material
            agg["G_items"].append(abs_amount)

    return _finalize_aggregate(by_tei)


def classify_and_aggregate(rows: list[dict]) -> list[AggregatedProperty]:
    """後方互換 API: rows をルールベースで分類して直接集計する。

    既存テスト・既存呼び出し元のシグネチャを維持する。
    """
    classified: list[dict] = []
    for row in rows:
        if is_aggregate_row(row.get("邸名", "")):
            continue
        try:
            int(round(float(row.get("税抜金額", 0))))
        except (TypeError, ValueError):
            continue
        result = classify_row(row)
        classified.append({**row, "category": result.category})
    return aggregate_classified_lines(classified)


def _finalize_aggregate(by_tei: dict) -> list[AggregatedProperty]:
    result = []
    for tei, agg in by_tei.items():
        amount_sales = sum(agg["D_items"])
        amount_shaho = agg["E"]
        amount_seisanka = agg["F"]
        amount_materials = sum(agg["G_items"])
        amount_other = 0
        gross_profit = amount_sales - amount_shaho - amount_seisanka - amount_materials - amount_other

        koji_names = list(agg["工事名称"])
        koji_label = "・".join(sorted(set(koji_names))) if koji_names else ""

        contracts = [c for c in agg["契約NO"] if c]
        contract_no = contracts[0] if contracts else ""

        result.append(AggregatedProperty(
            property_name=tei,
            contract_no=contract_no,
            koji_label=koji_label,
            amount_sales=amount_sales,
            amount_shaho=amount_shaho,
            amount_seisanka=amount_seisanka,
            amount_materials=amount_materials,
            amount_other=amount_other,
            gross_profit=gross_profit,
        ))
    return result


def _extract_koji_base(koushu: str) -> Optional[str]:
    if "防水" in koushu:
        return "防水"
    if "柱脚" in koushu:
        return "柱脚"
    return None
