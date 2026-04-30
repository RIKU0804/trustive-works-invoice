# Invoice SaaS — Self-hosted Deploy

公式 Supabase の docker stack をベースに、本リポジトリの **Next.js Web** と **Python API**
を 1 つの `docker compose` で立ち上げる完全 self-hosted 構成です。

```
┌─ Caddy (TLS) ──────────────────────────────────────────────┐
│   ${DOMAIN}        →  web (Next.js, :3000)                  │
│   ${API_DOMAIN}    →  kong (:8000) → auth / rest / realtime │
│                                     / storage              │
│   ${STUDIO_DOMAIN} →  kong (:8000) → studio (basic-auth)    │
└────────────────────────────────────────────────────────────┘
            │
            └─ python-api (:8001, internal only)
```

---

## 1. 必要環境

| 項目 | 推奨 |
|------|------|
| OS | Ubuntu 22.04 LTS / 24.04 LTS（Linux サーバー） |
| メモリ | 最低 4 GB（推奨 8 GB） |
| ディスク | 20 GB 以上の空き |
| Docker | 24.0+ |
| Docker Compose plugin | v2.20+ |
| ドメイン | A レコードを VPS の IP に向けられること |
| ポート開放 | 80 / 443 / TCP（外部から）<br>8000 / TCP（任意：Caddy を使わない場合） |

> ⚠️ Windows 上で開発したリポジトリですが、本番デプロイは **Linux 前提** です。
> Windows 上でビルドしたボリュームを Linux に持ち込む必要はありません — Linux サーバ上で
> `git clone` → `docker compose up` するだけで動きます。

### Docker のインストール（Ubuntu 例）

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

---

## 2. 初回セットアップ

### 2.1 リポジトリを取得

```bash
cd /opt    # any directory
sudo git clone https://github.com/<your-org>/invoice-saas2.git
sudo chown -R "$USER:$USER" invoice-saas2
cd invoice-saas2
```

### 2.2 シークレット生成 — `init.sh`（推奨）

`init.sh` は以下を自動生成して `deploy/.env` を作ります:

- `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY_BASE`
- `ANON_KEY` / `SERVICE_ROLE_KEY`（`JWT_SECRET` から HS256 で署名した JWT、有効期限 5 年）
- `DASHBOARD_PASSWORD`（Studio basic-auth）
- `PYTHON_API_KEY`（Web ⇄ Python API の共有シークレット）

```bash
bash deploy/init.sh
chmod 600 deploy/.env
```

### 2.3 ドメイン / OAuth 関連を埋める

```bash
$EDITOR deploy/.env
```

埋めるべき項目（`init.sh` 後に残るのは原則これだけ）:

```
DOMAIN=invoice.example.com
API_DOMAIN=api.invoice.example.com
STUDIO_DOMAIN=studio.invoice.example.com
ACME_EMAIL=admin@example.com

SITE_URL=https://invoice.example.com
API_EXTERNAL_URL=https://api.invoice.example.com
ADDITIONAL_REDIRECT_URLS=https://invoice.example.com,https://invoice.example.com/**

# 任意
GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_OAUTH_SECRET=GOCSPX-xxxx
ANTHROPIC_API_KEY=sk-ant-xxx
OPENROUTER_API_KEY=sk-or-xxx
```

### 2.4 シークレットを手動で作りたい場合

```bash
# JWT_SECRET / POSTGRES_PASSWORD など
openssl rand -base64 48 | tr -d '\n='

# SECRET_KEY_BASE（>= 64 byte 必須）
openssl rand -base64 96 | tr -d '\n='

# ANON_KEY / SERVICE_ROLE_KEY を Python で
python3 - <<'PY'
import base64, hashlib, hmac, json, time, os
secret = os.environ["JWT_SECRET"]
def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
now = int(time.time())
def jwt(role):
    h = b64url(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
    p = b64url(json.dumps({"role":role,"iss":"supabase","iat":now,"exp":now+60*60*24*365*5},separators=(',',':')).encode())
    s = b64url(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{s}"
print("ANON_KEY=",         jwt("anon"))
print("SERVICE_ROLE_KEY=", jwt("service_role"))
PY
```

> ⚠️ `JWT_SECRET` を後から変えると、すべての JWT が無効になり、ユーザーがサインインできなくなります。
> 初期セットアップ時に強い値を入れて、以後は触らないこと。

### 2.5 DNS 設定

3 つの A レコードをサーバーの IP に向けます:

| name | type | value |
|------|------|-------|
| `invoice.example.com` | A | `<server-ip>` |
| `api.invoice.example.com` | A | `<server-ip>` |
| `studio.invoice.example.com` | A | `<server-ip>` |

---

## 3. 起動

### 3.1 TLS 込みで一気に起動（推奨）

Caddy が Let's Encrypt から自動で証明書を取得します。

```bash
docker compose -f deploy/docker-compose.yml --profile with-tls up -d
docker compose -f deploy/docker-compose.yml ps
```

### 3.2 TLS なしで先に動作確認

```bash
docker compose -f deploy/docker-compose.yml up -d
# Kong は :8000 で外部公開される。試しに:
curl http://<server-ip>:8000/auth/v1/health
```

### 3.3 ログ

```bash
docker compose -f deploy/docker-compose.yml logs -f --tail=200
docker compose -f deploy/docker-compose.yml logs -f web
docker compose -f deploy/docker-compose.yml logs -f python-api
```

---

## 4. マイグレーション適用

`apps/web/supabase/migrations/*.sql` をデータベースに流します。
db コンテナが立ち上がっていれば、ホストから一発で:

```bash
# .env を読み込んでパスワードを取得
set -a && source deploy/.env && set +a

for f in apps/web/supabase/migrations/*.sql; do
  echo "==> $f"
  docker compose -f deploy/docker-compose.yml exec -T \
    -e PGPASSWORD="${POSTGRES_PASSWORD}" \
    db psql -U postgres -d postgres -f "/docker-entrypoint-initdb.d/migrations/$(basename "$f")"
done
```

> 補足: `db` コンテナは初回起動時に `docker-entrypoint-initdb.d/` 配下の SQL を自動実行
> しますが、Supabase イメージ自身の初期化スクリプトを優先するため、リポジトリの
> マイグレーションは **明示的に流す** 運用にしています。

`supabase` CLI がローカルにあるなら、リモート DB として接続して `supabase db push` も可能です:

```bash
supabase link --project-ref local --db-url "postgres://postgres:${POSTGRES_PASSWORD}@localhost:5432/postgres"
supabase db push
```

---

## 5. TLS — もう一つの選択肢: nginx-proxy-manager

Caddy のシンプルさを推奨しますが、GUI で管理したい人向けに `nginx-proxy-manager` も
動きます:

```yaml
# docker-compose.override.yml に追加するイメージ
nginx-proxy-manager:
  image: jc21/nginx-proxy-manager:latest
  ports: ["80:80", "443:443", "81:81"]
  volumes:
    - npm-data:/data
    - npm-letsencrypt:/etc/letsencrypt
```

ブラウザで `http://<server-ip>:81` にログインし（初期: admin@example.com / changeme）、
Proxy Host を 3 つ作って:

- `${DOMAIN}` → `web:3000`（同じ docker network に入れる）
- `${API_DOMAIN}` → `kong:8000`
- `${STUDIO_DOMAIN}` → `kong:8000`

この場合 `caddy` サービスは外す（`--profile with-tls` を付けない）。

---

## 6. アップデート手順

```bash
cd /opt/invoice-saas2
git pull --ff-only
docker compose -f deploy/docker-compose.yml --profile with-tls build --pull web python-api
docker compose -f deploy/docker-compose.yml --profile with-tls up -d
docker image prune -f
```

新しいマイグレーションが追加されている場合は **§4** を再実行。

---

## 7. バックアップ

### 7.1 Postgres のダンプ（推奨：cron）

```bash
mkdir -p /var/backups/invoice-saas
cat >/etc/cron.daily/invoice-saas-backup <<'SH'
#!/usr/bin/env bash
set -euo pipefail
TS="$(date +%Y%m%d-%H%M%S)"
OUT="/var/backups/invoice-saas/db-${TS}.sql.gz"
docker compose -f /opt/invoice-saas2/deploy/docker-compose.yml exec -T db \
  pg_dumpall -U postgres | gzip > "${OUT}"
find /var/backups/invoice-saas -mtime +30 -delete
SH
chmod +x /etc/cron.daily/invoice-saas-backup
```

### 7.2 Storage（PDF / Excel）のバックアップ

```bash
docker run --rm \
  -v invoice-saas_storage-data:/src:ro \
  -v /var/backups/invoice-saas:/dst \
  alpine tar czf /dst/storage-$(date +%Y%m%d).tgz -C /src .
```

> 名前付きボリュームを使っているので、ホストの `./data` ディレクトリには触らないこと。

### 7.3 リストア

```bash
gunzip -c db-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f deploy/docker-compose.yml exec -T \
  -e PGPASSWORD="${POSTGRES_PASSWORD}" db psql -U postgres -d postgres
```

---

## 8. トラブルシューティング

### 8.1 `auth` コンテナがクラッシュする

- `JWT_SECRET` が空か短すぎる。**32 文字以上** に。
- `SITE_URL` / `API_EXTERNAL_URL` が `http://` のまま → ブラウザは https を期待する場合がある。
- `db` のヘルスチェックが通る前に `auth` が起動した → `docker compose restart auth`。

### 8.2 Web から API キーで弾かれる

`docker compose exec web env | grep SUPABASE` で
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を確認。
**これらは build args としてイメージに焼き込まれる** ため、`.env` を変えただけでは
反映されない:

```bash
docker compose -f deploy/docker-compose.yml build --no-cache web
docker compose -f deploy/docker-compose.yml up -d web
```

### 8.3 Realtime が `SECRET_KEY_BASE` で起動しない

`SECRET_KEY_BASE` は **64 byte 以上**。`openssl rand -base64 96` で再生成。

### 8.4 Studio に入れない

basic-auth で `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`。デフォルト
`supabase` / `please-change-me-strong-pass` のままでないか確認。

### 8.5 `kong` が `kong.yml` 読めない

```bash
docker compose -f deploy/docker-compose.yml exec kong cat /home/kong/kong.yml
```

`$SUPABASE_ANON_KEY` 等が文字列のまま展開されていなければ、entrypoint の env 展開が
失敗している。`.env` の値に `$` を含む特殊文字が入っていないか要確認。

### 8.6 PDF アップロードで 413 (Request Entity Too Large)

Caddy 側の `request_body max_size` を上げる（既定 100 MB）。

### 8.7 Google OAuth の callback で 404

`GOOGLE_OAUTH_REDIRECT_URI` は **必ず** `${API_EXTERNAL_URL}/auth/v1/callback`。
Google Cloud Console の "Authorized redirect URIs" にも同じ URL を登録。

---

## 9. ファイル一覧

```
deploy/
├── docker-compose.yml      # メインのスタック定義
├── .env.example            # 環境変数テンプレート
├── .env                    # 実値（init.sh で生成、git ignore）
├── Caddyfile               # TLS リバプロ設定
├── README.md               # このファイル
├── init.sh                 # シークレット自動生成
└── volumes/
    ├── kong.yml            # Kong 宣言的設定
    └── db/init/            # （任意）db 初期 SQL を置く場所
```
