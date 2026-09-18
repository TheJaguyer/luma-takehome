#!/usr/bin/env bash
# One Slack app can only be in one mode at a time. Socket Mode is an app-level toggle: with it on,
# Slack delivers everything over the WebSocket the local bot holds and never calls the request
# URLs — so a deployed box sits there healthy, receiving nothing. Switching is a manifest paste,
# and this prints the right manifest.
#
#   deploy/slack-mode.sh local          Socket Mode on  → the stack from deploy/local.sh
#   deploy/slack-mode.sh prod [host]    Socket Mode off → the box at <host> (default: .env.production)
#   deploy/slack-mode.sh status         which workspace, which mode, and what is running here
#
# The manifest goes to stdout, so it pipes; everything else goes to stderr. On a terminal, with a
# clipboard tool available, it is copied for you.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '%s\n' "$@" >&2; }

# Values from a .env file, tolerating the inline comments .env.example ships with.
env_value() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- | sed 's/[[:space:]]*#.*$//; s/[[:space:]]*$//'; }

clip() {
  local tool
  for tool in wl-copy xclip pbcopy; do
    if command -v "$tool" >/dev/null 2>&1; then
      case $tool in
        xclip) xclip -selection clipboard ;;
        *) "$tool" ;;
      esac
      return 0
    fi
  done
  return 1
}

# Prints the manifest, and copies it when a person is watching and a clipboard exists.
emit() {
  local manifest=$1
  if [[ -t 1 ]] && printf '%s' "$manifest" | clip 2>/dev/null; then
    say "📋  Copied to the clipboard."
  fi
  printf '%s\n' "$manifest"
}

mode="${1:-}"
case "$mode" in
  local)
    say "🔌  LOCAL — Socket Mode on. Slack will talk to whatever holds the socket."
    emit "$(cat slack/manifest.yaml)"
    say "" \
        "  1. api.slack.com/apps → your app → App Manifest → paste over everything → Save" \
        "  2. Reinstall if Slack asks" \
        "  3. deploy/local.sh" \
        "  4. /shots health → expect  Slack ✅ (Socket Mode)"
    ;;

  prod)
    host="${2:-$(env_value .env.production SITE_ADDRESS)}"
    [[ -n "$host" ]] || { say "No host given and no SITE_ADDRESS in .env.production."; exit 1; }
    say "🔌  PROD — Socket Mode off. Slack will call https://$host/slack/events."
    emit "$(sed \
      -e "s#^      \# url: .*#      url: https://$host/slack/events#" \
      -e "s#^    \# request_url: .*#    request_url: https://$host/slack/events#" \
      -e "s#^    \# message_menu_options_url: .*#    message_menu_options_url: https://$host/slack/events#" \
      -e "s#^  socket_mode_enabled: true#  socket_mode_enabled: false#" \
      slack/manifest.yaml)"
    say "" \
        "  1. docker compose down            (the local bot must let go of the socket)" \
        "  2. api.slack.com/apps → your app → App Manifest → paste over everything → Save" \
        "  3. Reinstall if Slack asks, and check the Bot User OAuth Token still matches .env.production" \
        "  4. deploy/push.sh ubuntu@$host" \
        "  5. /shots health → expect  Slack ✅ (HTTP)  and  Base URL ✅ https://$host"
    ;;

  status)
    # Read-only. Never prints a token — only what the token says about itself.
    bot=$(env_value .env SLACK_BOT_TOKEN)
    app=$(env_value .env SLACK_APP_TOKEN)
    prod_bot=$(env_value .env.production SLACK_BOT_TOKEN)

    if [[ -n "$bot" ]]; then
      curl -s -m 10 -H "Authorization: Bearer $bot" https://slack.com/api/auth.test |
        python3 -c 'import json,sys
d = json.load(sys.stdin)
print("workspace   %s · bot @%s" % (d["team"], d["user"]) if d.get("ok") else "workspace   ⚠️  %s" % d.get("error"))'
    else
      echo "workspace   no SLACK_BOT_TOKEN in .env"
    fi

    # The same app in both files means one app doing two jobs — and only one can be live.
    if [[ -n "$bot" && "$bot" == "$prod_bot" ]]; then
      echo "apps        ⚠️  .env and .env.production are the SAME app — only one mode can be live"
    elif [[ -n "$prod_bot" ]]; then
      echo "apps        two separate apps (dev and prod)"
    fi

    if [[ -n "$app" ]]; then
      # The only way to ask whether the toggle is on: try to open a connection, as Bolt does.
      curl -s -m 10 -X POST -H "Authorization: Bearer $app" https://slack.com/api/apps.connections.open |
        python3 -c 'import json,sys
d = json.load(sys.stdin)
print("mode        SOCKET — events go to whatever holds the socket, not to the deployed box"
      if d.get("ok") else "mode        HTTP — events go to the request URL (%s)" % d.get("error"))'
    else
      echo "mode        no SLACK_APP_TOKEN in .env (so: HTTP)"
    fi

    running=$(docker compose ps --status running --format '{{.Service}}' 2>/dev/null | sort | tr '\n' ' ')
    echo "local       ${running:-nothing running}"

    host=$(env_value .env.production SITE_ADDRESS)
    if [[ -n "$host" ]]; then
      code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "https://$host/products/HG-001/images" || true)
      echo "remote      https://$host → ${code:-unreachable}$([[ $code == 200 ]] && echo "  (serving)")"
    fi
    ;;

  *)
    say "usage: deploy/slack-mode.sh local | prod [host] | status"
    exit 1
    ;;
esac
