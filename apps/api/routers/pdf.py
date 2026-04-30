import os
import tempfile
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile

from core.auth import verify_api_key
from schemas.models import (
    AIClassification,
    ClassifiedLine,
    ParseResponse,
)
from services.ai_classifier import classify_low_confidence_rows
from services.classifier import (
    aggregate_classified_lines,
    classify_row,
    is_aggregate_row,
)
from services.pdf_parser import extract_payment_date, extract_rows, extract_totals

router = APIRouter(prefix="/pdf", tags=["pdf"])


@router.post("/parse", response_model=ParseResponse)
async def parse_pdf(
    file: UploadFile = File(...),
    _: str = Depends(verify_api_key),
    x_organization_id: str = Header(..., alias="X-Organization-Id"),
):
    contents = await file.read()

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        payment_date = extract_payment_date(tmp_path)
        totals = extract_totals(tmp_path)
        rows = extract_rows(tmp_path)

        if rows is None:
            raise HTTPException(
                status_code=422,
                detail="PDFからデータを抽出できませんでした。テキストPDFか確認してください。",
            )

        # ステップ1: 各行をルールベースで分類して信頼度を付ける
        classified_rows: list[dict] = []
        for row in rows:
            if is_aggregate_row(row.get("邸名", "")):
                continue
            try:
                int(round(float(row.get("税抜金額", 0))))
            except (TypeError, ValueError):
                continue
            rule_result = classify_row(row)
            classified_rows.append({
                **row,
                "category": rule_result.category,
                "classification_confidence": rule_result.confidence,
            })

        # ステップ2: 信頼度の低い行を AI で再分類 (APIキー無しなら no-op)
        refined_rows, ai_records = classify_low_confidence_rows(classified_rows)

        # ステップ3: 集計
        properties = aggregate_classified_lines(refined_rows)

        # ステップ4: フロント返却用に行データを整形
        lines = [
            ClassifiedLine(
                property_name=r.get("邸名", ""),
                contract_no=r.get("契約NO", ""),
                work_type=r.get("工種", ""),
                note=r.get("備考", ""),
                amount_excl_tax=int(round(float(r.get("税抜金額", 0)))),
                consumption_tax=int(r.get("消費税", 0) or 0),
                amount_incl_tax=int(r.get("税込金額", 0) or 0),
                category=r.get("category", "material"),
                classification_confidence=float(r.get("classification_confidence", 0.0)),
                classification_method=r.get("classification_method", "rule"),
                ai_reasoning=r.get("ai_reasoning"),
            )
            for r in refined_rows
        ]

        ai_classifications = [
            AIClassification(
                line_index=rec.line_index,
                prompt_input=rec.prompt_input,
                ai_response=rec.ai_response,
                model=rec.model,
                input_tokens=rec.input_tokens,
                output_tokens=rec.output_tokens,
                latency_ms=rec.latency_ms,
                error=rec.error,
            )
            for rec in ai_records
        ]
    finally:
        os.unlink(tmp_path)

    return ParseResponse(
        payment_date=payment_date,
        transfer_amount=totals["furikomi"],
        offset_amount=totals["sousai"],
        properties=properties,
        lines=lines,
        ai_classifications=ai_classifications,
        raw_row_count=len(rows),
    )
