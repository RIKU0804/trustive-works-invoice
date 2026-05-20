import io

import pdfplumber
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from core.auth import verify_api_key
from core.config import settings
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

# DoS 対策: ページ数上限 (1ファイルあたり)
MAX_PDF_PAGES = 200


def _build_response(contents: bytes) -> ParseResponse:
    """同期の重い処理 (PDF パース + AI 分類)。

    呼び出し元の async エンドポイントから run_in_threadpool 経由で実行し、
    イベントループをブロックしないようにする。
    """
    # PDF は1回だけ開いて全抽出関数で使い回す (3回 open していたのを是正)
    try:
        pdf = pdfplumber.open(io.BytesIO(contents))
    except Exception:
        raise HTTPException(
            status_code=422,
            detail="PDFを開けませんでした。破損しているか、PDF形式ではありません。",
        )

    with pdf:
        if len(pdf.pages) > MAX_PDF_PAGES:
            raise HTTPException(
                status_code=413,
                detail=f"PDFのページ数が上限({MAX_PDF_PAGES})を超えています。",
            )

        payment_date = extract_payment_date(pdf)
        totals = extract_totals(pdf)
        rows = extract_rows(pdf)

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

    return ParseResponse(
        payment_date=payment_date,
        transfer_amount=totals["furikomi"],
        offset_amount=totals["sousai"],
        pdf_koujidai_zeinuki=totals.get("pdf_koujidai_zeinuki"),
        pdf_koujidai_zeikomi=totals.get("pdf_koujidai_zeikomi"),
        properties=properties,
        lines=lines,
        ai_classifications=ai_classifications,
        raw_row_count=len(rows),
    )


@router.post("/parse", response_model=ParseResponse)
async def parse_pdf(
    file: UploadFile = File(...),
    _: str = Depends(verify_api_key),
    x_organization_id: str = Header(..., alias="X-Organization-Id"),
):
    # X-Organization-Id は呼び出し側 (Next.js サーバ) がテナント分離を担保する前提。
    # この API 自体はキー↔org のマッピングを持たないため、形式のみ最低限検証する。
    org_id = (x_organization_id or "").strip()
    if not (1 <= len(org_id) <= 100):
        raise HTTPException(status_code=400, detail="X-Organization-Id が不正です。")

    # DoS 対策: 上限+1 だけ読み、超過したら 413。全量をメモリ展開しない。
    max_bytes = settings.max_upload_bytes
    contents = await file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"ファイルサイズが上限({max_bytes}バイト)を超えています。",
        )
    if not contents:
        raise HTTPException(status_code=400, detail="空のファイルです。")

    # マジックバイト検証 (Content-Type ヘッダはクライアント任意のため信頼しない)
    if not contents.lstrip()[:5].startswith(b"%PDF-"):
        raise HTTPException(
            status_code=415,
            detail="PDFファイルではありません (%PDF- ヘッダがありません)。",
        )

    # 重い同期処理はスレッドプールへ退避し、イベントループをブロックしない
    return await run_in_threadpool(_build_response, contents)
