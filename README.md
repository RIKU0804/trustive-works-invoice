# invoice-saas2

支払通知書PDFを自動集計するSaaS。双建工業株式会社向け。

## アーキテクチャ
- **Web**: Next.js 14 (App Router) on Vercel
- **API**: Python FastAPI (pdfplumber) on Railway
- **DB/Auth/Storage**: Supabase Cloud
- **AI**: OpenRouter (Claude Haiku 4.5) for low-confidence row classification

## ディレクトリ構成
```
apps/web/        Next.js フロントエンド
apps/api/        Python FastAPI バックエンド
deploy/          Self-host用 Docker Compose
docs/            仕様書（10ファイル）
```

## ローカル開発
```bash
# Supabase
cd apps/web && npx supabase start

# Python API
cd apps/api && python -m uvicorn main:app --reload --port 8001

# Next.js
cd apps/web && npm install && npm run dev
```

## デプロイ
- ハイブリッド構成: `apps/web` Vercel + `apps/api` Railway + Supabase Cloud
- 自前ホスト: `deploy/README.md` 参照（Docker Compose一式）

## ライセンス
社内利用のみ
