from pydantic import BaseModel, Field
from typing import Literal, Optional


class ParsedRow(BaseModel):
    jigyosho: str = Field("", alias="事業所")
    keiyaku_no: str = Field("", alias="契約NO")
    tei_mei: str = Field("", alias="邸名")
    koushu: str = Field("", alias="工種")
    amount_before_tax: int = Field(0, alias="税抜金額")
    tax: int = Field(0, alias="消費税")
    amount_with_tax: int = Field(0, alias="税込金額")
    bikou: str = Field("", alias="備考")

    model_config = {"populate_by_name": True}


# 1行ごとの分類結果（プレビューでハイライト用にフロントへ返す）
ClassificationCategory = Literal["sales", "shaho", "seisanka", "material"]
ClassificationMethod = Literal["rule", "ai", "manual"]


class ClassifiedLine(BaseModel):
    property_name: str
    contract_no: str = ""
    work_type: str = ""
    note: str = ""
    amount_excl_tax: int
    consumption_tax: int = 0
    amount_incl_tax: int = 0
    category: ClassificationCategory
    classification_confidence: float = Field(0.0, ge=0.0, le=1.0)
    classification_method: ClassificationMethod
    ai_reasoning: Optional[str] = None


class AIClassification(BaseModel):
    """AI 呼び出し1件分のメタデータ。Next.js 側で ai_classifications テーブルに保存する。"""
    line_index: int  # ClassifiedLine の配列インデックスと対応
    prompt_input: dict
    ai_response: Optional[dict] = None
    model: str
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None


class AggregatedProperty(BaseModel):
    property_name: str
    contract_no: str
    koji_label: str
    amount_sales: int
    amount_shaho: int
    amount_seisanka: int
    amount_materials: int
    amount_other: int
    gross_profit: int


class ParseResponse(BaseModel):
    payment_date: Optional[str]
    transfer_amount: Optional[int]
    offset_amount: Optional[int]
    properties: list[AggregatedProperty]
    lines: list[ClassifiedLine] = Field(default_factory=list)
    ai_classifications: list[AIClassification] = Field(default_factory=list)
    raw_row_count: int


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
