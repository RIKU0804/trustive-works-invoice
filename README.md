# invoice-saas2

支払通知書PDFを自動集計するSaaS。

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
- 環境変数・運用手順は `docs/12-operations.md` 参照

## CI/CD
`.github/workflows/ci.yml` で 3 ジョブを実行 (PR + main への push):

- `api`: `pytest -q` (Python API)
- `web-types`: `tsc --noEmit` + `npm run lint`
- `web-build`: `next build` (placeholder env で疎通確認のみ)

## エラー監視 (Sentry)
既定では **Sentry は無効**。追加コストと依存を避けるため雛形のみ用意:

- `apps/web/sentry.client.config.ts.example`
- `apps/web/sentry.server.config.ts.example`
- `apps/web/sentry.edge.config.ts.example`
- `apps/web/instrumentation.ts.example`
- `apps/api/core/sentry.py.example`

### 有効化手順
1. Web:
   ```bash
   cd apps/web
   npm install @sentry/nextjs
   mv sentry.client.config.ts.example sentry.client.config.ts
   mv sentry.server.config.ts.example sentry.server.config.ts
   mv sentry.edge.config.ts.example sentry.edge.config.ts
   mv instrumentation.ts.example instrumentation.ts
   ```
   `NEXT_PUBLIC_SENTRY_DSN` を Vercel に設定。
   CSP は別途調整が必要だが、本リポジトリでは別エージェントが管理しているため
   ここでは `next.config.mjs` を Sentry でラップしていない。

2. API:
   - `requirements.txt` と `pyproject.toml` に `sentry-sdk[fastapi]==2.*` を追加
   - `apps/api/core/sentry.py.example` → `sentry.py` にリネーム
   - `apps/api/main.py` で `from core.sentry import init_sentry; init_sentry()` を呼ぶ
   - Railway に `SENTRY_DSN` を設定

Sentry の Free tier (5K events/月) で現状運用には十分。

## ライセンス
社内利用のみ
