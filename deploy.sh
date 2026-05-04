#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Pulling latest code..."
git pull

echo "==> Rebuilding Hearth..."
docker compose up -d --build

echo "==> Waiting for Hearth to be ready..."
for i in $(seq 1 20); do
  if docker compose exec -T hearth sqlite3 /data/hearth.db "SELECT 1;" &>/dev/null; then
    break
  fi
  sleep 2
done

echo "==> Reading webhook secret from Hearth DB..."
SECRET=$(docker compose exec -T hearth sqlite3 /data/hearth.db "SELECT value FROM settings WHERE key='email_webhook_secret';")

if [ -z "$SECRET" ]; then
  echo "ERROR: Could not read email_webhook_secret from Hearth DB" >&2
  exit 1
fi

echo "==> Syncing secret to Cloudflare Worker..."
cd "$SCRIPT_DIR/email-worker"
echo "$SECRET" | npx wrangler secret put HEARTH_WEBHOOK_SECRET --non-interactive 2>/dev/null \
  || printf '%s' "$SECRET" | npx wrangler secret put HEARTH_WEBHOOK_SECRET

echo "==> Deploying email worker..."
npx wrangler deploy

echo ""
echo "Done. Hearth is up and email worker is deployed."
echo "Email address: hearth@mjflanigan.com"
