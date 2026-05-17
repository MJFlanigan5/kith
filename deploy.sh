#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Pulling latest code..."
git pull

echo "==> Rebuilding Kith..."
docker compose build --no-cache
docker compose up -d

echo "==> Waiting for Kith to be ready..."
for i in $(seq 1 20); do
  if docker compose exec -T kith sqlite3 /data/kith.db "SELECT 1;" &>/dev/null; then
    break
  fi
  sleep 2
done

echo "==> Reading webhook secret from Kith DB..."
SECRET=$(docker compose exec -T kith sqlite3 /data/kith.db "SELECT value FROM settings WHERE key='email_webhook_secret';")

if [ -z "$SECRET" ]; then
  echo "ERROR: Could not read email_webhook_secret from Kith DB" >&2
  exit 1
fi

echo "==> Syncing secret to Cloudflare Worker..."
cd "$SCRIPT_DIR/email-worker"
echo "$SECRET" | npx wrangler secret put HEARTH_WEBHOOK_SECRET --non-interactive 2>/dev/null \
  || printf '%s' "$SECRET" | npx wrangler secret put HEARTH_WEBHOOK_SECRET

echo "==> Deploying email worker..."
npx wrangler deploy

echo ""
echo "Done. Kith is up and email worker is deployed."
