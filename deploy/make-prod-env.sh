#!/usr/bin/env bash
# Writes .env.production for a deployed box: fresh secrets, the hostname, and the API keys already
# in your local .env / .env.local. Slack values are left blank — they come from the *prod* Slack
# app (HTTP mode), not the Socket Mode dev app. Never prints a secret.
#
#   deploy/make-prod-env.sh shutter.example.com
set -euo pipefail
cd "$(dirname "$0")/.."

host="${1:?usage: deploy/make-prod-env.sh <hostname>}"
out=.env.production
[[ -e $out ]] && { echo "$out already exists; delete it first to regenerate secrets." >&2; exit 1; }

# Reads KEY from local env files without echoing it.
local_value() { grep -h "^$1=" .env .env.local 2>/dev/null | tail -1 | cut -d= -f2- || true; }

umask 077
cat > "$out" <<ENV
# Generated $(date -u +%Y-%m-%dT%H:%MZ) for $host. Copied to the server as .env by deploy/push.sh.
SITE_ADDRESS=$host
PUBLIC_BASE_URL=https://$host

# Prod Slack app (HTTP mode). No SLACK_APP_TOKEN here: its absence is what selects HTTP.
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=

ANTHROPIC_API_KEY=$(local_value ANTHROPIC_API_KEY)
LUMA_AGENTS_API_KEY=$(local_value LUMA_AGENTS_API_KEY)

POSTGRES_PASSWORD=$(openssl rand -hex 24)
GARAGE_RPC_SECRET=$(openssl rand -hex 32)
GARAGE_ADMIN_TOKEN=$(openssl rand -hex 32)
S3_ACCESS_KEY_ID=GK$(openssl rand -hex 12)
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
ENV
echo "Wrote $out. Fill in SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET from the prod Slack app."
