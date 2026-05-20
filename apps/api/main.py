from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from routers import health, pdf

# 本番で安全でない設定のまま起動するのを防ぐ (フェイルファスト)
settings.assert_production_ready()

app = FastAPI(
    title="Invoice SaaS API",
    description="支払い通知書PDFの自動集計API",
    version="0.1.0",
)

# 財務 PII を扱う API のため CORS はワイルドカードにせず明示許可のみ。
# 通常運用 (Next.js サーバからの server-to-server 呼び出し) は CORS の対象外。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["X-API-Key", "X-Organization-Id", "Content-Type"],
)

app.include_router(health.router)
app.include_router(pdf.router)
