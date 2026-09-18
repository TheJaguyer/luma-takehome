# The Slack app

For the whole install, start at [`INSTALL.md`](../INSTALL.md) — this file is just the Slack half.

| File | What it is |
|---|---|
| `manifest.yaml` | The whole app, except the icon: scopes, events, the `/shots` command, Socket Mode on for local |
| `icon/` | Where the app icon lives, and why it is not in the manifest |

Create the app at [api.slack.com/apps](https://api.slack.com/apps) → **From a manifest** → paste
`manifest.yaml`. For a deployed app, `deploy/slack-manifest.sh <host>` prints the same file with
Socket Mode off and every request URL pointed at that host.

Two apps, on purpose: **dev** runs in Socket Mode against `deploy/local.sh` and needs no public URL;
**prod** runs over HTTP behind Caddy. They are separate Slack apps with separate tokens, so both
need the icon set (`icon/README.md`) and both can be installed in the same workspace.

`/shots help` is the canonical command list. `manifest.yaml`'s `usage_hint` repeats it for the
typeahead, and `pnpm test` fails if the two disagree (`src/bot/commands.test.ts`).
