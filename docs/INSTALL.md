# Install and demo Shutter

Shutter turns a home-goods catalogue's shot ideas into approved, published product images, and it
lives entirely in Slack. This document takes you from an empty machine to an approved image on a
public URL.

**Two paths. Pick one before you start:**

| | **A — Local** | **B — Your own server** |
|---|---|---|
| Time | ~15 min | ~40 min |
| You need | Docker, a Slack workspace you can create apps in | the same, plus a VM and a DNS name you control |
| Public URL | `http://localhost` (your machine only) | `https://your-host` with a real certificate |
| Slack transport | **Socket Mode** — an outbound WebSocket, so no inbound URL, no tunnel, no port forwarding | **HTTP** — Slack calls your host |
| Good for | trying it, developing, following along with the video | showing it to other people; the image URLs work from anywhere |

Both paths run the identical stack from the identical `compose.yaml`. The only differences are
three environment variables and which Slack app you point at.

> **Written to be followed literally,** by a person or by an agent. Every step has a command and a
> way to check it worked. Where a step needs a human decision (a name, a workspace, a hostname),
> it says so and says what the choice affects.

---

## 0. What you are installing

Six containers, one Compose file:

| Service | What it is | Public? |
|---|---|---|
| `caddy` | The only thing with open ports. Routes `/slack/*`, `/products/*`, `/images/*`; gets the TLS certificate | 80, 443 |
| `bot` | Slack: commands, buttons, modals, file drops | no |
| `worker` | Everything that happens without a person: CSV imports, idea drafting, Luma generation, the daily post | no |
| `lookup` | `GET /products/{SKU}/images` — the read-only API the website calls | no |
| `postgres` | All state | no |
| `garage` | S3-compatible object storage: source photos, candidates, approved images | no |

Plus two one-shot containers that run before the rest on every `up`: `migrate` (database schema)
and `storage-init` (bucket, key, public read). Both are idempotent.

**API keys it needs:** Anthropic (drafting shot ideas) and Luma (generating images). Nothing else.

---

## 1. Prerequisites

```bash
docker --version && docker compose version && git --version
```

Docker 24+ with the Compose plugin. That is the whole list — **Node and pnpm are not required**:
everything builds and runs inside the image. (`pnpm install` is only needed if you want to run
`pnpm test` or your editor's type checking on the host.)

**Port 80 must be free** on whichever machine runs the stack. If something else holds it:

```bash
sudo lsof -i :80
```

---

## 2. Get the code

```bash
git clone <this repo> shutter && cd shutter
```

---

## 3. Create the Slack app

This is the only part that cannot be scripted — Slack requires a human in their web UI.

**You need a workspace where you can create apps.** Most personal workspaces allow it; a corporate
one often does not. If you cannot create an app, make a free workspace at
[slack.com/create](https://slack.com/create) — it takes two minutes and costs nothing.

### 3a. Create it from the manifest

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** → **Create New App** → **From a manifest**
2. Choose your workspace
3. Paste the contents of **`slack/manifest.yaml`** (for Path A, as-is — it defaults to Socket Mode)
4. **Create**

The manifest sets the name, the `/shots` command, every scope and every event subscription. Nothing
else in the Slack UI needs configuring for Path A.

### 3b. Install it and collect three values

| Value | Where | Looks like |
|---|---|---|
| `SLACK_BOT_TOKEN` | **OAuth & Permissions** → *Install to Workspace* first, then copy **Bot User OAuth Token** | `xoxb-…` |
| `SLACK_SIGNING_SECRET` | **Basic Information** → *App Credentials* → Signing Secret → *Show* | 32 hex chars |
| `SLACK_APP_TOKEN` | **Basic Information** → *App-Level Tokens* → **Generate Token and Scopes** → name it anything → add the **`connections:write`** scope → Generate | `xapp-…` |

The app token is what makes Socket Mode work. **Path B does not use it** — its absence is what
switches the bot to HTTP mode.

### 3c. Optional: give it a face

The manifest cannot set the app icon; Slack has no field for it. **Basic Information → Display
Information → App icon**, square PNG or JPG, 512–2000 px. See `slack/icon/README.md`.

Skip it if you like — it only affects how the bot looks.

---

# Path A — Local

## A1. Write `.env`

```bash
cp .env.example .env
```

Edit `.env` and set these five. Everything else in the file is optional or has a working default.

```bash
ANTHROPIC_API_KEY=sk-ant-…
LUMA_AGENTS_API_KEY=…
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
SLACK_APP_TOKEN=xapp-…
```

Notes:

- If you have the challenge archive's `.env.local` with the Luma key in it, leave it where it is —
  `compose.yaml` reads both files and `.env.local` wins.
- Leave `SITE_ADDRESS` and `PUBLIC_BASE_URL` commented out. They default to `http://localhost`.
- The Postgres and Garage secrets are commented out too. Local defaults are fine and are *meant*
  to be weak; Path B generates real ones.

**Useful for a demo:** uncomment `STUCK_AFTER_MINUTES=5`. The stuck list and nudges normally wait
three days, which is not a thing you can show in a video.

## A2. Start it

```bash
deploy/local.sh
```

First run builds the image (2–4 minutes). Afterwards it is seconds.

**Check it worked:**

```bash
docker compose ps
```

`bot`, `worker`, `lookup`, `caddy`, `postgres`, `garage` all `Up`. `migrate` and `storage-init`
have `Exited (0)` — that is correct, they are one-shot.

```bash
docker compose logs bot | tail -3
```

You want `"msg":"bot started"` with `"socketMode":true`.

> `[WARN] bolt-app Socket Mode is not turned on` in the log is **normal and misleading** — Bolt
> prints it while connecting. The `"socketMode":true` line after it is the truth.

```bash
curl -s localhost/products/HG-001/images
```

Expect `{"sku":"HG-001","requested_theme":null,"served_theme":"default","images":[]}`. An empty
list is right — nothing is imported yet. **If you get JSON here, the whole stack is wired up.**

Now skip to **[First run](#first-run-the-demo-itself)**.

---

# Path B — Your own server

Everything from Path A applies, with a real hostname and TLS. These instructions are written for
Ubuntu 24.04 on EC2; any VM with Docker and a public IP works the same way.

## B1. A machine

**4 GB RAM minimum.** The build (pnpm, sharp, Prisma) is memory-hungry; `deploy/ec2/user-data.sh`
adds 2 GB of swap for exactly this reason. `t3.small` is enough; `t3.medium` builds faster.

On EC2, launch Ubuntu 24.04 and paste **`deploy/ec2/user-data.sh`** into *Advanced details → User
data*. Cloud-init runs it once on first boot: swap, Docker, Compose, rsync, and an empty
`/home/ubuntu/shutter`. On another provider, do the same by hand.

**Security group / firewall — inbound:**

| Port | From | Why |
|---|---|---|
| 22 | your IP | `deploy/push.sh` uses ssh |
| 80 | anywhere | Let's Encrypt's HTTP-01 challenge, and it redirects to 443 |
| 443 | anywhere | Slack's requests, the lookup API, the images |

Give it a **static/Elastic IP**. A reboot that changes the IP breaks DNS and the certificate.

**Check it worked:** `ssh ubuntu@<ip> 'docker --version && ls -d shutter'`. If `docker` is missing,
user data has not finished (or failed) — read `/var/log/cloud-init-output.log`.

## B2. DNS

Point an A record at the IP, then wait for it to actually resolve:

```bash
dig +short shots.example.com
```

**Do this before B5.** Caddy asks Let's Encrypt for a certificate on first start, and if DNS does
not resolve yet the request fails and Caddy backs off — you will be waiting on a retry rather than
on anything you can fix.

## B3. A second Slack app, in HTTP mode

Path B needs its **own** Slack app. Socket Mode and HTTP mode are per-app settings, and you want to
keep the local one working.

```bash
deploy/slack-mode.sh prod shots.example.com
```

This prints `slack/manifest.yaml` with Socket Mode off and all three request URLs pointed at your
host. Create a second app from it exactly as in step 3, install it, and collect **two** values —
bot token and signing secret. **No app token:** its absence is what selects HTTP mode.

The two apps can live in the same workspace — though Slack will not let both own `/shots`, so the
second one needs a different command name. Different icons make them easy to tell apart.

> **If you reuse one app for both instead of creating a second**, they cannot both work. Socket Mode
> is an app-level toggle: with it on, Slack delivers everything over the WebSocket the local bot
> holds and **never calls the request URLs** — so the deployed box sits there healthy, serving
> images, receiving no events. Switch modes with:
>
> ```bash
> deploy/slack-mode.sh status          # which workspace, which mode, what is running
> deploy/slack-mode.sh prod            # print the manifest that points Slack at the server
> deploy/slack-mode.sh local           # …and the one that points it back at your machine
> ```
>
> Paste the output over the app's manifest at **api.slack.com/apps → App Manifest**, reinstall if
> asked, and stop whichever stack is not the one you want answering.

## B4. Generate the production environment

```bash
deploy/make-prod-env.sh shots.example.com
```

Writes `.env.production`: the hostname, your Anthropic and Luma keys copied from the local `.env`,
and freshly generated Postgres/Garage secrets. It never prints a secret and refuses to overwrite an
existing file.

Then fill in the two blanks by hand from the **prod** app:

```bash
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
```

`.env.production` is gitignored. It is the only copy of those generated secrets — losing it means
the database and bucket on the server are unreachable.

## B5. Ship it

```bash
deploy/push.sh ubuntu@<ip>
```

rsyncs the tree (excluding `.git`, `node_modules`, every `.env*`), copies `.env.production` to the
server as `.env` with mode 600, builds and starts.

**Check it worked:**

```bash
curl -s https://shots.example.com/products/HG-001/images
```

JSON over HTTPS with a valid certificate means Caddy, the lookup and Let's Encrypt all worked.

```bash
ssh ubuntu@<ip> 'cd shutter && docker compose logs bot | tail -3'
```

`"msg":"bot started"` with `"socketMode":false`.

Finally, in Slack, `/shots health` should answer with three ticks and `(HTTP)`. If the command times
out, the request URL is wrong or the certificate is not up yet — see [Troubleshooting](#troubleshooting).

---

# First run: the demo itself

Identical on both paths.

## 1. Invite the bot

Create a channel — `#shot-reviews` is the name the docs use — and:

```
/invite @shutter
```

**The invite is the configuration.** Whichever channel you invite it to becomes the review channel;
there is nothing else to configure.

The bot replies immediately, asking who the approver is (it guesses you, because you invited it).

> Nothing happened? The bot only hears the invite if it was already running. `/shots setup` in the
> channel starts the same flow.

## 2. Answer two questions

**Who approves** — tap *That's right*, or hand it to someone else.

The approver decides in one tap. Anyone else can still approve, but it is a deliberate
*force-approve* and it is recorded with their name. This is the most distinctive judgement in the
design, and it is worth trying both ways.

**The house style** — free text, in your own words. It steers every shot idea drafted from here on.
Something like:

> Warm, lived-in, natural light. Real homes, not showrooms. Uncluttered — one or two props at most.

Then the bot posts the integration message for the web developer and says it is ready. Setup is
over; those really are the only two questions.

## 3. Import a catalogue

Drag a CSV into the channel. **Start with the small one:**

| File | Rows | Cost of a full pass |
|---|---|---|
| `data/samples/short.csv` | 5 | ~$0.90 |
| `data/catalog.csv` | 40 | ~$7 |
| `data/samples/catalog-edge-cases.csv` | 7 | one of every import problem: a 404 photo URL, a row with no SKU, a duplicated SKU, and an existing SKU whose price changed |

The bot reads it, reports what it found, and asks one question: **is this batch for a theme?**
Choose *No theme* for the first run.

> **Worth a second import later:** `catalog-edge-cases.csv`. Every row in it is a different problem,
> and the summary is where the import's judgement shows — what it took, what it dropped and why,
> what it flagged, and what it changed *nothing* about. Dropping it costs a few cents in drafting
> and generates nothing.

Then it drafts three shot ideas per product — a few seconds each — and posts one card per product.
**Nothing has generated an image yet, and nothing has cost more than a fraction of a cent.** The
idea gate is the spend gate.

## 4. Approve an idea

Each card shows three one-line options. Tap **1**, **2** or **3**.

- A product that arrived with a Shot Idea in the sheet has its own idea as option 1, marked
  *(from import)*.
- **More…** lets you edit an option, write your own, or skip.
- **Details** posts the full scenes into the thread.

Approving starts generation. The card becomes the product's one message and updates in place:
🔄 generating → 🖼 pick one. Four candidates, about 70 seconds, about $0.17.

## 5. Approve an image

The message shows a numbered 2×2 contact sheet. Tap a number to open it full size **beside the
product's original photo** — that comparison is the only fidelity check in the system.

**Approve** publishes it. Immediately:

```bash
curl -s localhost/products/HG-002/images | head -20
```

(or your hostname on Path B). The image is live at an immutable URL. There is no upload step and
no publish button — **approval is publication**, and the notice in the thread carries a one-tap
**Revert**.

Approve a second one and the product is done.

## 6. Look around

| | |
|---|---|
| `/shots status` | Everything, in three zoom levels. Every count links to the first item in it |
| `/shots HG-002` | One product |
| `/shots endpoints` | What the web developer needs: URL shape, every theme, the response contract |
| `/shots export` | `products.csv` (status + image links) and the full event log, posted to the channel |
| `/shots daily` | The 9am report and nudges, now — for demos |
| `/shots health` | Database, storage and Slack |
| `/shots help` | Everything else |

**Two more things worth showing**, because they are the ones people do not expect:

- **Drop a photo in the channel.** The bot asks what it is — *a finished shot* (goes straight to
  review as a candidate, from a photographer, no AI) or *a new product photo* (replaces the source
  and generates again). Getting that fork wrong is expensive in both directions, so it is asked,
  never inferred.
- **Re-drop the same CSV.** Nothing duplicates. Import is idempotent.

---

## Resetting between runs

```bash
deploy/local.sh --reset-catalog    # everything an import made; keeps channel, approver, style
deploy/local.sh --reset-factory    # the above plus setup — the bot is as new
```

`deploy/push.sh ubuntu@<ip> --reset-catalog` does the same on a server, and makes you type the
hostname first.

After `--reset-factory` the bot is still in the channel, so no invite event fires. Run
`/shots setup`, or kick and re-invite it to see the real first-run path.

Old Slack messages survive either reset and their buttons point at deleted rows — they do nothing
and log an error. Scroll past, or use a fresh channel.

---

## What a run costs

Measured, not estimated:

| | |
|---|---|
| Drafting three ideas for one product | $0.005–0.007, 6–9s (Sonnet 5, prompt cached) |
| One generated image (Luma `uni-1`) | $0.0434, 62–69s |
| One round of 4 candidates | ~$0.17, ~72s end to end |
| `short.csv`, 5 products, one round each | ~$0.90 |

The cost of anything that spends money is printed on the button before you press it.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/shots` says "failed with the error dispatch_failed" | The bot is not running, or not connected | `docker compose logs bot \| tail -20` |
| Bot log: `Invalid configuration: SLACK_BOT_TOKEN…` | A variable is missing from `.env` | Config is validated at startup on purpose. Fill it in and `deploy/local.sh` |
| `[WARN] bolt-app Socket Mode is not turned on` | Nothing | Normal during connect. The `"socketMode":true` line below it is the truth |
| Invited the bot, nothing happened | It was not running when the invite fired | `/shots setup` in the channel |
| Dropped a CSV, no reaction | Not the review channel, or setup unfinished | The bot only reads files in the channel it was invited to |
| Ideas never appear | Anthropic key | `docker compose logs worker \| grep -i draft`, then `/shots ideas` to retry |
| Candidates stuck "generating" | Luma key, credits, or the 10-in-flight cap | `docker compose logs worker \| grep -i luma`. `/shots retry` re-queues what came back short |
| Images 404 at `/images/...` | `storage-init` did not finish | `docker compose logs storage-init` |
| Port 80 in use | Something else has it | Stop it, or change the `caddy` port mapping in `compose.yaml` |
| **Path B:** no certificate | DNS not resolving when Caddy first asked | Fix DNS, then `docker compose restart caddy`. `docker compose logs caddy` shows the ACME attempts |
| The **local** bot answers while the deployed one gets nothing | One Slack app with Socket Mode on: the socket wins and the request URLs are never called | `deploy/slack-mode.sh status`, then `prod` to switch |
| **Path B:** `/shots` times out | Request URL wrong, or the app still in Socket Mode | The prod app needs all three URLs and `socket_mode_enabled: false` — paste `deploy/slack-mode.sh prod <host>` |
| **Path B:** the product typeahead in the photo-upload form is empty | The options URL is not set | HTTP mode needs `message_menu_options_url` as well as `request_url` — the generated manifest sets it |
| Build OOMs on the server | Under 4 GB and no swap | `deploy/ec2/user-data.sh` adds 2 GB. Add it by hand if you skipped user data |

---

## Can other workspaces install the deployed one?

**No.** One bot token per deployment, and three things assume it: the worker holds a single Slack
client, the lookup resolves a SKU globally (two workspaces both importing `HG-002` would serve each
other's images), and one Anthropic and one Luma key would pay for everyone.

Making it multi-workspace means distributed OAuth *plus* per-team tokens in the worker *plus*
tenanting the public URL shape. That is `REQUIREMENTS.md` Part 4's **Tenancy model**, deferred with
the trigger *a second customer committing*.

To let someone else try it: invite them into your workspace, or send them this document.

---

## Appendix: every variable

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | Drafting shot ideas (Sonnet 5) |
| `LUMA_AGENTS_API_KEY` | yes | — | Image generation (`uni-1`) |
| `SLACK_BOT_TOKEN` | yes | — | `xoxb-…` |
| `SLACK_SIGNING_SECRET` | yes | — | Verifies Slack's requests |
| `SLACK_APP_TOKEN` | Path A only | — | `xapp-…`, `connections:write`. **Present = Socket Mode.** Absent = HTTP |
| `SITE_ADDRESS` | Path B | `http://localhost` | Bare hostname deployed → Caddy gets a certificate |
| `PUBLIC_BASE_URL` | Path B | `http://localhost` | The base of every image URL. **Written into approved-image URLs**, so changing it later strands old ones |
| `POSTGRES_PASSWORD` | Path B | `shots` | |
| `GARAGE_RPC_SECRET` | Path B | weak dev value | 64 hex: `openssl rand -hex 32` |
| `GARAGE_ADMIN_TOKEN` | Path B | weak dev value | |
| `S3_ACCESS_KEY_ID` | Path B | weak dev value | `GK` + 24 hex |
| `S3_SECRET_ACCESS_KEY` | Path B | weak dev value | 64 hex |
| `S3_BUCKET` | no | `shots` | |
| `LUMA_MAX_CONCURRENT` | no | `10` | Luma's pay-as-you-go cap on generations in flight |
| `STUCK_AFTER_MINUTES` | no | — | Shortens the stuck/nudge threshold from 3 days. **Demos only** |
| `LOG_LEVEL` | no | `info` | |

`deploy/make-prod-env.sh` generates every Path B secret for you. Missing required variables fail at
startup with the name of the variable, not later at a request.

## Appendix: every command

```bash
deploy/local.sh                          # build and start locally
deploy/local.sh --reset-catalog          # …and clear the catalogue first
deploy/local.sh --reset-factory          # …and clear setup too
deploy/slack-mode.sh status              # which workspace, which mode, what is running
deploy/slack-mode.sh local               # print the manifest that points Slack at your machine
deploy/slack-mode.sh prod [host]         # …and the one that points it at the server
deploy/make-prod-env.sh <host>           # write .env.production with fresh secrets
deploy/push.sh ubuntu@<ip> [--reset-*]   # rsync, build and start on the server

docker compose ps                        # what is running
docker compose logs -f bot worker        # follow both
docker compose down                      # stop (volumes, and so all data, survive)
docker compose down -v                   # stop and delete the data

pnpm install && pnpm test && pnpm typecheck   # on the host; needs Node 24 and pnpm 12
```
