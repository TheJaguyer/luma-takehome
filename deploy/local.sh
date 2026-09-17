#!/usr/bin/env bash
# Builds and (re)starts the local stack.
#
#   deploy/local.sh                   build and start
#   deploy/local.sh --reset-catalog   also clear every product, idea, round and image first
#                                     (setup — channel, approver, house style — is kept)
#   deploy/local.sh --reset-factory   also clear the setup itself, so the bot is as new: the next
#                                     `/shots setup` (or a kick and re-invite) runs Flow 0 again
set -euo pipefail
cd "$(dirname "$0")/.."

reset=""
for arg in "$@"; do
  case "$arg" in
    --reset-catalog) reset="--catalog" ;;
    --reset-factory) reset="--factory" ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

docker compose build
if [[ -n "$reset" ]]; then
  # Nothing may write while the tables are cleared: stop the two services that do.
  # `run` brings up postgres, garage, migrate and storage-init first, so the schema is current.
  docker compose stop bot worker
  docker compose run --rm worker node --import tsx src/scripts/reset.ts "$reset" --yes
fi
docker compose up -d --remove-orphans
docker compose ps

if [[ "$reset" == "--factory" ]]; then
  echo
  echo "🧹  Factory reset. The bot is still in the channel, so no invite event will fire:"
  echo "    run '/shots setup' there, or kick and re-invite it to see Flow 0 from the top."
fi
