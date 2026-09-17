#!/usr/bin/env bash
# Prints the prod Slack app manifest: slack/manifest.yaml switched to HTTP mode for <hostname>.
#
#   deploy/slack-manifest.sh shutter.example.com
set -euo pipefail
cd "$(dirname "$0")/.."
host="${1:?usage: deploy/slack-manifest.sh <hostname>}"
url="https://$host/slack/events"

sed \
  -e "s#^      \# url: .*#      url: $url#" \
  -e "s#^    \# request_url: .*#    request_url: $url#" \
  -e "s#^  socket_mode_enabled: true#  socket_mode_enabled: false#" \
  slack/manifest.yaml
