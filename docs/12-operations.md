# 12. 運用ランブック

本番運用に必要な手順をまとめる。新メンバーがオンコールに入った時に
最初に読むドキュメント。

## 環境変数

### Web (Next.js / Vercel)

| 変数 | 用途 | 必須 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL | ◯ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | クライアント用 anon key | ◯ |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバアクション用 (RLS バイパス) | ◯ |
| `PYTHON_API_URL` | FastAPI のベース URL (例: `https://api.example.com`) | ◯ |
| `PYTHON_API_KEY` | FastAPI 共有鍵 (`X-API-Key` で送る) | ◯ |
| `NEXT_PUBLIC_SITE_URL` | 本番ドメイン (`https://...`) | Server Actions の CSRF 許可で必要 |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry を有効化する場合のみ | × |
| `SENTRY_DSN` | サーバサイド Sentry (任意) | × |

### API (FastAPI / Railway)

| 変数 | 用途 | 必須 |
|---|---|---|
| `API_KEY` | Web → API の共有鍵。`dev-secret` のままだと本番で起動拒否 | ◯ |
| `CORS_ORIGINS` | Web ドメインをカンマ区切りで列挙 | 推奨 |
| `MAX_UPLOAD_BYTES` | デフォルト 15 MB | × |
| `AI_ENABLED` | `true` で AI 再分類有効 (課金発生) | × |
| `AI_PROVIDER` | `openrouter` (既定) または `anthropic` | × |
| `OPENROUTER_API_KEY` | `AI_ENABLED=true` かつ OpenRouter 利用時 | 条件付き |
| `ANTHROPIC_API_KEY` | `AI_PROVIDER=anthropic` 利用時 | 条件付き |
| `SENTRY_DSN` | Sentry を有効化する場合のみ | × |

`debug=False` のまま `API_KEY` が既定値だと `assert_production_ready()` で
起動を弾く設計 (詳細は `apps/api/core/config.py`)。

## デプロイ手順

### Web (Vercel)

1. Vercel ダッシュボードで `apps/web` をルートに設定
2. Build Command: 既定 (`npm run build`)
3. Install Command: 既定 (`npm ci`)
4. Output Directory: `.next` (Next.js 既定)
5. 上記の環境変数を Production / Preview 両方に設定
6. `main` への push で本番デプロイ、PR で Preview デプロイ

### API (Railway)

1. Railway で `apps/api` のリポジトリをリンク
2. Dockerfile 検出される (`apps/api/Dockerfile`)
3. 環境変数を設定 (`API_KEY` は `openssl rand -hex 32` などで生成)
4. デプロイ後、`https://<service>.up.railway.app/health` で疎通確認

### Supabase

- マイグレーションは `apps/web/supabase/migrations/` 配下に YYYYMMDDHHMMSS のタイムスタンプ命名で追加
- 本番反映:
  ```bash
  cd apps/web
  npx supabase link --project-ref <project-ref>
  npx supabase db push
  ```
- マイグレーション履歴は書き換えず、前進マイグレーションで是正する
  (`20260519000000_security_hardening.sql` の方針)

### Self-host (Docker Compose)

`deploy/README.md` 参照。Web + API + Supabase ローカル一式を立てる。

## エラー監視 (Sentry)

既定では Sentry SDK は導入していない (`@sentry/nextjs` / `sentry-sdk` 共に未インストール)。
雛形ファイルは下記に置いてある:

- `apps/web/sentry.client.config.ts.example`
- `apps/web/sentry.server.config.ts.example`
- `apps/web/sentry.edge.config.ts.example`
- `apps/web/instrumentation.ts.example`
- `apps/api/core/sentry.py.example`

有効化手順は README の "Error tracking (Sentry)" セクション参照。
無料枠 (5K events/月) で当面の運用には十分。

## CI/CD

`.github/workflows/ci.yml` で 3 ジョブ:

- `api`: `pytest -q` (`apps/api`)
- `web-types`: `tsc --noEmit` + `npm run lint`
- `web-build`: `next build` (placeholder env で実行)

PR ごとと `main` への push でトリガー。

## Parse status reaper (停滞 PDF の救済)

`payment_notices.parse_status = 'parsing'` のまま 15 分経過したレコードは
`reap_stale_parse_status()` で `failed` に降格させる。

### pg_cron が使える場合

`20260525000050_parse_reaper_job.sql` の末尾コメントアウトを外して
5 分ごとに自動実行。

### 手動 / 外部スケジューラ

```bash
# psql で直接
psql "$SUPABASE_DB_URL" -c "select public.reap_stale_parse_status();"
```

または Supabase MCP / Supabase SQL editor から同 SQL を実行。
詰まりが疑われた時 (UI のスピナーが永続するというユーザ報告) は手動で 1 回打って様子を見る。

## レート制限

middleware で IP / org 単位のレート制限を実装している (`apps/web/middleware.ts`)。
ハマった場合の調査:

1. Supabase ダッシュボード → Logs → 該当 org の `429` を確認
2. middleware の対応する KV / メモリ store を確認
   (実装詳細はミドルウェア担当エージェントが管理)

## ログ

| サービス | ログの場所 |
|---|---|
| Web (Vercel) | Vercel ダッシュボード → Project → Logs (リアルタイム) |
| API (Railway) | Railway ダッシュボード → Service → Logs |
| Supabase | Supabase ダッシュボード → Logs (Postgres / Auth / Storage 別) |
| Sentry (有効時) | Sentry ダッシュボード → Issues |

PDF アップロードのトレースは `payment_notices.id` を grep キーとして
Vercel ログ → Railway ログ → Supabase の順に追うのが鉄則。

## トラブルシュート

### PDF が `parsing` のまま固まる
1. `select public.reap_stale_parse_status();` を手動実行
2. Railway の API ログでクラッシュ / OOM を確認
3. 再アップロードを依頼

### 振込金額の照合差が大きい
- `docs/03-business-logic.md` の振込照合セクション参照
- 立替金 (`amount_tatekae`) が抜けていないか `properties` を SQL で確認

### Server Actions が CORS / CSRF で落ちる
- `NEXT_PUBLIC_SITE_URL` (or `SITE_URL`) が本番ドメインに設定されているか確認
  (`next.config.mjs` の `allowedOrigins` で参照される)

## チェックリスト (リリース前)

- [ ] Supabase マイグレーション push 済
- [ ] Vercel/Railway 環境変数を Production にコピー
- [ ] `API_KEY` を強力なランダム値に
- [ ] `/health` で API 疎通確認
- [ ] サンプル PDF で 1 回 end-to-end テスト
- [ ] (任意) Sentry を有効化
