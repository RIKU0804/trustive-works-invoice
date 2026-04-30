#!/usr/bin/env bash
# init.sh — Bootstrap a fresh deploy/.env with strong, freshly-generated secrets.
#
# Generates:
#   • POSTGRES_PASSWORD     (32 random bytes, base64)
#   • JWT_SECRET            (40 random bytes, base64)
#   • SECRET_KEY_BASE       (64 random bytes, base64) — Realtime needs >= 64
#   • ANON_KEY              (HS256 JWT signed with JWT_SECRET, role=anon)
#   • SERVICE_ROLE_KEY      (HS256 JWT signed with JWT_SECRET, role=service_role)
#   • DASHBOARD_PASSWORD    (24 random bytes, base64)
#   • PYTHON_API_KEY        (32 random bytes, hex)
#
# Existing .env is backed up to .env.backup.<timestamp>.
#
# Usage:   bash deploy/init.sh
# Requires: openssl, python3 (for JWT signing — no third-party deps).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
EXAMPLE_FILE="${SCRIPT_DIR}/.env.example"

if [[ ! -f "${EXAMPLE_FILE}" ]]; then
  echo "[init] ERROR: ${EXAMPLE_FILE} not found" >&2
  exit 1
fi

# Back up an existing .env (don't overwrite without trace).
if [[ -f "${ENV_FILE}" ]]; then
  ts="$(date +%Y%m%d-%H%M%S)"
  cp "${ENV_FILE}" "${ENV_FILE}.backup.${ts}"
  echo "[init] backed up existing .env -> .env.backup.${ts}"
fi

cp "${EXAMPLE_FILE}" "${ENV_FILE}"

rand_b64() {
  # Strip trailing '=' padding and any newlines so the value sits cleanly on one line.
  openssl rand -base64 "$1" | tr -d '\n=' | head -c "$2"
}

POSTGRES_PASSWORD="$(rand_b64 48 40)"
JWT_SECRET="$(rand_b64 48 40)"
SECRET_KEY_BASE="$(rand_b64 96 80)"
DASHBOARD_PASSWORD="$(rand_b64 32 24)"
PYTHON_API_KEY="$(openssl rand -hex 32)"

# ─── Sign anon / service_role JWTs (HS256, pure stdlib) ───────────────────
mk_jwt() {
  local role="$1"
  local secret="$2"
  python3 - "$role" "$secret" <<'PY'
import base64, hashlib, hmac, json, sys, time

role, secret = sys.argv[1], sys.argv[2]

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")

now = int(time.time())
header  = {"alg": "HS256", "typ": "JWT"}
payload = {
    "role": role,
    "iss":  "supabase",
    "iat":  now,
    "exp":  now + 60 * 60 * 24 * 365 * 5,  # 5 years
}

signing_input = f"{b64url(json.dumps(header,  separators=(',', ':')).encode())}." \
                f"{b64url(json.dumps(payload, separators=(',', ':')).encode())}"
sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
print(f"{signing_input}.{b64url(sig)}")
PY
}

ANON_KEY="$(mk_jwt anon         "${JWT_SECRET}")"
SERVICE_ROLE_KEY="$(mk_jwt service_role "${JWT_SECRET}")"

# ─── Patch the .env file in-place (BSD/GNU sed compatible) ────────────────
patch_env() {
  local key="$1"
  local val="$2"
  local file="$3"
  # Escape sed special chars in the value
  local esc; esc="$(printf '%s' "${val}" | sed -e 's/[\/&|]/\\&/g')"
  # Use | as delimiter to keep slashes safe
  if grep -q "^${key}=" "${file}"; then
    sed -i.bak "s|^${key}=.*|${key}=${esc}|" "${file}"
  else
    echo "${key}=${val}" >> "${file}"
  fi
  rm -f "${file}.bak"
}

patch_env POSTGRES_PASSWORD   "${POSTGRES_PASSWORD}"   "${ENV_FILE}"
patch_env JWT_SECRET          "${JWT_SECRET}"          "${ENV_FILE}"
patch_env SECRET_KEY_BASE     "${SECRET_KEY_BASE}"     "${ENV_FILE}"
patch_env ANON_KEY            "${ANON_KEY}"            "${ENV_FILE}"
patch_env SERVICE_ROLE_KEY    "${SERVICE_ROLE_KEY}"    "${ENV_FILE}"
patch_env DASHBOARD_PASSWORD  "${DASHBOARD_PASSWORD}"  "${ENV_FILE}"
patch_env PYTHON_API_KEY      "${PYTHON_API_KEY}"      "${ENV_FILE}"

chmod 600 "${ENV_FILE}"

cat <<EOF
[init] OK — secrets generated and written to ${ENV_FILE}

Next steps:
  1. Edit ${ENV_FILE} and fill in:
       DOMAIN / API_DOMAIN / STUDIO_DOMAIN / ACME_EMAIL
       SITE_URL / API_EXTERNAL_URL / ADDITIONAL_REDIRECT_URLS
       (optional) GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_SECRET
       (optional) ANTHROPIC_API_KEY / OPENROUTER_API_KEY
       (optional) SMTP_*

  2. Point your DNS A record at this server.

  3. Bring the stack up:
       docker compose -f deploy/docker-compose.yml up -d                # without TLS
       docker compose -f deploy/docker-compose.yml --profile with-tls up -d   # with Caddy TLS

  4. Apply migrations (see deploy/README.md).
EOF
