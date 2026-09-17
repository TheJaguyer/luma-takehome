#!/usr/bin/env bash
# Ships the working tree to the server and (re)starts the stack there.
#
#   deploy/push.sh ubuntu@<static-ip>
#   deploy/push.sh ubuntu@<static-ip> --reset-catalog   also clear every product, idea, round and
#                                                      approved image on the server (setup is kept);
#                                                      asks you to type the hostname first
#
# The 1-day stack's deploy: rsync + build on the box. The ideal stack replaces this with GitHub
# Actions → registry → pull (REQUIREMENTS, "Build + deploy"); nothing in compose.yaml changes.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:?usage: deploy/push.sh ubuntu@<host> [--reset-catalog]}"
shift
reset=false
for arg in "$@"; do
  case "$arg" in
    --reset-catalog) reset=true ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done
dir=shutter

[[ -f .env.production ]] || { echo "No .env.production — run deploy/make-prod-env.sh first." >&2; exit 1; }
grep -q '^SLACK_BOT_TOKEN=xoxb-' .env.production || { echo "SLACK_BOT_TOKEN is empty in .env.production." >&2; exit 1; }

if $reset; then
  # Production data, and approved images the live site may be serving: make it deliberate.
  host="${target#*@}"
  echo "⚠️  --reset-catalog deletes every product, idea, round and approved image on $host."
  echo "   Approved image URLs stop working. Setup (channel, approver, house style) is kept."
  read -r -p "   Type the host ($host) to continue: " typed
  [[ "$typed" == "$host" ]] || { echo "Cancelled; nothing was deployed." >&2; exit 1; }
fi

rsync -az --delete \
  --exclude .git --exclude node_modules --exclude src/generated \
  --exclude '.env' --exclude '.env.*' --exclude .take-home-token --exclude dist \
  ./ "$target:$dir/"
rsync -az --chmod=F600 .env.production "$target:$dir/.env"

remote="cd $dir && docker compose build"
if $reset; then
  remote+=" && docker compose stop bot worker && docker compose run --rm worker node --import tsx src/scripts/reset-catalog.ts --yes"
fi
remote+=" && docker compose up -d --remove-orphans && docker compose ps"
ssh "$target" "$remote"
