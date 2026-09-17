#!/usr/bin/env bash
# Ships the working tree to the server and (re)starts the stack there.
#
#   deploy/push.sh ubuntu@<static-ip>
#
# The 1-day stack's deploy: rsync + build on the box. The ideal stack replaces this with GitHub
# Actions → registry → pull (REQUIREMENTS, "Build + deploy"); nothing in compose.yaml changes.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:?usage: deploy/push.sh ubuntu@<host>}"
dir=shutter

[[ -f .env.production ]] || { echo "No .env.production — run deploy/make-prod-env.sh first." >&2; exit 1; }
grep -q '^SLACK_BOT_TOKEN=xoxb-' .env.production || { echo "SLACK_BOT_TOKEN is empty in .env.production." >&2; exit 1; }

rsync -az --delete \
  --exclude .git --exclude node_modules --exclude src/generated \
  --exclude '.env' --exclude '.env.*' --exclude .take-home-token --exclude dist \
  ./ "$target:$dir/"
rsync -az --chmod=F600 .env.production "$target:$dir/.env"

ssh "$target" "cd $dir && docker compose up -d --build --remove-orphans && docker compose ps"
