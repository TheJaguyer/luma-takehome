#!/usr/bin/env bash
# Ships the working tree to the server and (re)starts the stack there.
#
#   deploy/push.sh ubuntu@<static-ip>
#   deploy/push.sh ubuntu@<static-ip> --reset-catalog   also clear every product, idea, round and
#                                                      approved image on the server (setup is kept)
#   deploy/push.sh ubuntu@<static-ip> --reset-factory   also clear the setup itself, so the bot is
#                                                      as new and Flow 0 runs again
#
# Either reset asks you to type the hostname first: this is production data, and approved image
# URLs the live site may be serving stop working.
#
# The 1-day stack's deploy: rsync + build on the box. The ideal stack replaces this with GitHub
# Actions → registry → pull (REQUIREMENTS, "Build + deploy"); nothing in compose.yaml changes.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:?usage: deploy/push.sh ubuntu@<host> [--reset-catalog|--reset-factory]}"
shift
reset=""
for arg in "$@"; do
  case "$arg" in
    --reset-catalog) reset="--catalog" ;;
    --reset-factory) reset="--factory" ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done
dir=shutter

[[ -f .env.production ]] || { echo "No .env.production — run deploy/make-prod-env.sh first." >&2; exit 1; }
grep -q '^SLACK_BOT_TOKEN=xoxb-' .env.production || { echo "SLACK_BOT_TOKEN is empty in .env.production." >&2; exit 1; }

if [[ -n "$reset" ]]; then
  # Production data, and approved images the live site may be serving: make it deliberate.
  host="${target#*@}"
  echo "⚠️  This deletes every product, idea, round and approved image on $host."
  echo "   Approved image URLs stop working."
  if [[ "$reset" == "--factory" ]]; then
    echo "   --reset-factory also clears the review channel, the approvers and the house style."
  else
    echo "   Setup (channel, approver, house style) is kept."
  fi
  read -r -p "   Type the host ($host) to continue: " typed
  [[ "$typed" == "$host" ]] || { echo "Cancelled; nothing was deployed." >&2; exit 1; }
fi

rsync -az --delete \
  --exclude .git --exclude node_modules --exclude src/generated \
  --exclude '.env' --exclude '.env.*' --exclude .take-home-token --exclude dist \
  ./ "$target:$dir/"
rsync -az --chmod=F600 .env.production "$target:$dir/.env"

remote="cd $dir && docker compose build"
if [[ -n "$reset" ]]; then
  remote+=" && docker compose stop bot worker && docker compose run --rm worker node --import tsx src/scripts/reset.ts $reset --yes"
fi
remote+=" && docker compose up -d --remove-orphans && docker compose ps"
ssh "$target" "$remote"

if [[ "$reset" == "--factory" ]]; then
  echo
  echo "🧹  Factory reset. The bot is still in the channel, so no invite event will fire:"
  echo "    run '/shots setup' there, or kick and re-invite it to see Flow 0 from the top."
fi
