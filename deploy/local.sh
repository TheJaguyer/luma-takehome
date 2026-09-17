#!/usr/bin/env bash
# Builds and (re)starts the local stack.
#
#   deploy/local.sh                   build and start
#   deploy/local.sh --reset-catalog   also clear every product, idea, round and image first
#                                     (setup — channel, approver, house style — is kept)
set -euo pipefail
cd "$(dirname "$0")/.."

reset=false
for arg in "$@"; do
  case "$arg" in
    --reset-catalog) reset=true ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

docker compose build
if $reset; then
  # Nothing may write while the tables are cleared: stop the two services that do.
  # `run` brings up postgres, garage, migrate and storage-init first, so the schema is current.
  docker compose stop bot worker
  docker compose run --rm worker node --import tsx src/scripts/reset-catalog.ts --yes
fi
docker compose up -d --remove-orphans
docker compose ps
