from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import health, pdf

app = FastAPI(
    title="Invoice SaaS API",
    description="支払い通知書PDFの自動集計API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(pdf.router)
