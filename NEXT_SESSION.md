# Next session — plan

> **Temporary working document.** Written 2026-09-16 at the end of the build. Delete it (or fold what
> matters into APPROACH.md) before submitting.

## Where things stand

- **The Part 5 build is complete** — the spine plus both deliberate additions — committed through
  `8db348a`. Every step was tested by hand in Slack, locally and on EC2.
- **28 unit tests** (`pnpm test`), all passing; `pnpm typecheck` clean.
- **Deploy:** `deploy/local.sh [--reset-catalog|--reset-factory]` locally; `deploy/push.sh ubuntu@<ip> [--reset-catalog|--reset-factory]`
  to EC2 (types the host before a reset). Two Slack apps: dev (Socket Mode) and prod (HTTP).
- **Cheap test data:** `data/samples/short.csv` (5 products: 2 with sheet ideas, 3 without — about
  $0.90 for a full pass), `data/samples/catalog-edge-cases.csv` (one of every import problem).
- **Demo helpers:** `/shots daily` posts today's report and nudges now; `STUCK_AFTER_MINUTES=5` in
  `.env` makes things count as stuck within minutes.

## Open questions

Everything still unanswered, gathered in one place. **A** comes from the planning docs; **B** are
defaults chosen during the build that were stated but never explicitly confirmed; **C** are places
where the docs now lag what was built. Each is a user call.

### A. Open in the planning docs

1. **Is the raw sheet idea choosable as-is?** USER_FLOWS Flow 2, Step 3, *Interpretation to check*:
   it's shown as context only. If it should be directly approvable, it becomes a `0️⃣ As written`
   option on the card.
2. **REQUIREMENTS §C — the one unchecked box:** "record observed latency and cost per image". Two
   data points are recorded; still missing is **cost per *approved* image** (needs an approval rate
   from a real run — the export's Spend and Approved Images columns, or the event log).
3. **`/shots style` "suggest one from your existing shot ideas"** — Flow 0, Step 3 promises it as
   #3b's seeding kept as an opt-in. Not built; `/shots style` only edits.
4. **`[Nudge an approver instead]`** — Flow 3, Step 6 and ASSUMPTIONS #1 offer it beside
   force-approve. Not built (the force-approve modal has only Cancel).
5. **Standing "Watch" items** — not questions to answer now, but the signals APPROACH.md's *what
   I'd watch after it ships* should name: forced-approval counts climbing (#1); products sitting at
   exactly 2 images (#4c vs #5a); a large review pile at full-catalog scale (#8); AI-provenance
   metadata auto-labelling social posts before Q4 (#16 — and "Maya should confirm what applies");
   candidates reaching the stuck list while the approver was active (Flow 3 Step 1, revised).

### B. Build defaults stated but not explicitly confirmed

| Default | Where | Alternative |
|---|---|---|
| Edit lives under **More…** (*Edit 1/2/3…*), not an `[Edit…]` button | Step 5, idea cards | A separate Edit button that asks which option |
| `--reset-catalog` also clears **themes** and the **event log** | `src/scripts/reset.ts` | Keep themes as reusable chips; keep the audit trail |
| Export column details: sheet headers first, approver **display name**, formula cells escaped | Step 7 | Slack IDs; no escaping |
| `STUCK_AFTER_MINUTES` for demos; a drop **goes quiet** after the stuck threshold (3 days) | Step 8 | A separate quiet threshold |
| **Generate more** asks a non-approver for a reason too (on top of the feedback sentence) | Step 6 | Feedback sentence alone for everyone |
| **None of these**, **Try a different idea** and **Retry missing** need no approver and no reason | Steps 5–6 | Approval rule on any of them |
| Campaign question shows the **3 most recent** themes as chips | Step 4 | All themes, or most used |
| Drafting runs at **effort `medium`** on Sonnet 5 | Step 5 | `high` (more thinking, higher cost) |
| #13a's trigger wording and the Provisioned Throughput price quoted | ASSUMPTIONS #13a | — |
| Flow 3's revised signal suggests a **thread reply "candidates are back"** as the first fix | USER_FLOWS Flow 3 Step 1 | — (suggestion, not a request) |
| Runtime uses **`tsx`**, not compiled JS | Dockerfile | A build step with emitted JS |

### C. Where the docs now lag the build

- **ASSUMPTIONS #3b and #5a** still say a themed round for an already-done product "moves no progress
  number — watch it". Step 9 partly resolved this: drops, completion and the stuck list count
  **per campaign** now; only product-level status keeps done at 2 total. Amend in place, keeping the
  original reasoning.
- **REQUIREMENTS Part 2** still reads "QC TBD (#14)" — QC was deferred to Part 4 (#14a).
- **USER_FLOWS flow index** ("What of this gets built in the ~1 day") predates the build: check each
  row against what shipped (e.g. Flow 7's `[Make primary]` isn't built; Flow 2's priority setter).
- **REQUIREMENTS Part 5** could note what was built beyond the plan (catalog reset, retry,
  `/shots daily`, `/shots themes`) and what the build revised (Flow 1 Step 4, Flow 3 Steps 1 and 4).

## The plan, in order

### 1. Refinement pass — each built flow, small style and flow changes

Go flow by flow in Slack. Rough edges noticed while building are listed as a starting point — none
is decided; each is the user's call.

**Flow 0 — Setup**
- Moving the review channel and `/shots approvers` are deferred; a second invite only says so.
- The "lookup URL" message is long — worth reading on a phone.
- No way to see current settings (candidates per round, max rounds, nudge threshold) from Slack.

**Flow 1 — Import**
- Every import with products now asks the campaign question (step 9); check it still feels like
  one tap for a routine re-import.
- `[Show details]` posts into the thread each time it's tapped (no dedupe).
- Drop name from a junk filename is "Import of <date>" — check it reads well with `[Rename]`.
- After either reset, old Slack messages keep buttons that point at deleted rows (they do
  nothing and log an error).

**Flow 2 — Idea review**
- Edit lives under **More…** (*Edit 1… / Edit 2… / Edit 3…*) rather than an `[Edit…]` button —
  confirm on a phone.
- Skipped cards show `[Review again]`; Flow 2 says skip "sorts to the end", which isn't modelled.
- `[Details]` posts full scenes into the card's thread each tap.
- The priority flag (#7) has no setter yet, so "priority first" never triggers.
- Queue message wording ("Tap a number to approve it").

**Flow 3 — Candidates and approval**
- Full-size modal: title is truncated to 24 chars (Slack limit); check `◂ ▸` and "Back to all".
- Done state collapses to one line with `[See all 4]` — confirm that's the right final look.
- Approval notice links `view file` — on local it's `http://localhost/...`.
- `[Make primary]` (Flow 7, decision 7.1) isn't built; primary is always first approved.
- "None of the rest" label once something is approved.

**Flow 4 — Status and nudges**
- `/shots status` posts publicly in the channel (Flow 4 says read-only and public) — check noise.
- Stuck list rows link to the product message; "Upload" for a missing photo has nowhere to go
  (Flow 6 not built).
- Spend line on a drop reads "spent on these products" (includes their other campaigns).
- Daily post at 9am in the approver's Slack timezone; drop goes quiet after the stuck threshold.

**Flow 7 — Lookup and themes**
- `curl '<host>/products/HG-002/images?theme=holiday'`; confirm the integration message's wording.
- `/shots themes` → Edit look.

### 2. Flows and features not built — decide each

From REQUIREMENTS Part 5 *Next* (with their triggers) and Part 4. In Part 5's own pull order:

| Item | Size | Why it might come in now |
|---|---|---|
| **Flow 6 — replace source photo** | ~1h | The only fix for the *needs a source photo* flag v1 ships; the stuck list has nowhere to send those rows |
| **Flow 5 — photographer upload** | ~1h with Flow 6 | Shares Flow 6's upload gesture; cheaper together |
| **Import change-review** (Flow 1, Step 6) | ~1.25h+ | v1 reports changes as "not applied"; the photo half needs Flow 6's versioning |
| **`/shots approvers`** | ~30min | Setup names one approver; no way to add a second |
| `[Make primary]` (Flow 7, 7.1) | ~30min | Primary is always first-approved today |
| Priority flag setter (#7) | ~20min | "Priority first" exists everywhere but can't be set |
| Archive / unarchive (#6, #8) | ~45min | Skip covers "not now" at 40 products |
| `/shots images HG-002` (Part 4) | ~30min | Drive's job without Drive |
| Multi-product grouping (#10) | ~1.5h | Helps the site more than the queue |
| Budget thresholds, spend comparisons (#13) | ~45min | Trigger: a second drop completing |

### 3. Small details to nail

**Bot profile picture**
- Slack app icon: **square PNG/JPG, 512–2000 px**, set in *api.slack.com/apps → Basic Information →
  Display Information → App icon* (the manifest can't set it). Set it on **both** apps (dev and prod).
- Options to decide: design one (a camera shutter, matching the name), or generate candidates.

**Install instructions — two audiences**

> **1 is done:** `INSTALL.md` covers both paths (local Socket Mode, own server with HTTPS) end to
> end, through to an approved image on a public URL. **2 was decided:** no distributed OAuth —
> invite reviewers into the workspace, or send them `INSTALL.md`. See its closing section.

1. **Deploying this application** (an operator or a reviewer running their own copy). Material exists
   across `.env.example`, `slack/manifest.yaml`, `deploy/*.sh` and REQUIREMENTS; needs one ordered
   guide: prerequisites (Docker, pnpm optional), create the Slack app from the manifest (dev: Socket
   Mode; prod: `deploy/slack-mode.sh prod <host>`), keys (Anthropic, Luma, Slack), `deploy/local.sh`,
   EC2 (`deploy/ec2/user-data.sh`, security group, Elastic IP, DNS, `make-prod-env.sh`, `push.sh`),
   `/invite @shutter`, verify with `/shots health`. Decide: README section vs `INSTALL.md`.
2. **Interviewers trying the bot in their own Slack** — **an open decision, and a real constraint:**
   the app is single-workspace (one bot token per deployment; distributed OAuth was rejected in
   REQUIREMENTS *The stack* — 2–3h, and a tenancy decision). Options to weigh:
   - **Invite reviewers into the existing workspace** (the prod channel), as members or guests —
     zero build, and they use the real deployed bot. Guests can't be approvers (Flow 0), so a
     reviewer would force-approve, or be made a full member.
   - **"Create your own app" guide** — they create an app from the manifest in *their* workspace and
     point it at *their own* deployment (the deploy guide above). Their Slack, but a full deploy.
   - **Distributed OAuth** so one deployment installs into any workspace — the "real" answer, and
     the one already rejected for time; revisit only if trying it in their own workspace matters
     more than the rest of this list.

### 4. Then: APPROACH.md and video preparation

Raw material already recorded (so writing is mostly assembly):
- **Built and why:** Slack-only surface (#2), the idea gate as the spend gate (#3), one product = one
  message (Flow 3 Step 1, revised), approval = publication with revert (#4).
- **Road not taken:** REQUIREMENTS *What was rejected, and what it would have cost* (two independent
  stacks, Python, Railway/Fly/Render, Kubernetes, external S3, SQS, distributed OAuth), plus each
  flow's *Rejected:* notes.
- **Scope ledger:** REQUIREMENTS Part 5 (in / next with triggers) and Part 4 (out with triggers).
- **Unit economics — measured:** drafting $0.005–0.007 and 6–9s per product (Sonnet 5, cached);
  `uni-1` edit $0.0434 per image, 62–69s; a round of 4 ≈ $0.17 and ~72s end to end; **cost per
  *approved* image depends on approval rate — pull it from the event log / export after a real
  run**. At 10× (300 → 3,000 products): Luma's 10-in-flight cap (#13a) is ~9 images/minute, so a
  full drop is hours, not minutes → Provisioned Throughput or a higher tier; a single worker →
  pg-boss.
- **What breaks first:** Luma concurrency (#13a); the single-replica worker (counts free slots, posts
  the daily run); one disk on one box (Postgres + Garage); notifications lost to in-place edits
  (Flow 3 Step 1's signal); Slack rate limits on posting 40+ cards.
- **Video:** first 3 minutes for the team in their language (drop a CSV → ideas → approve on a phone
  → candidates → approve → live on the lookup → `/shots status`), then the engineering walkthrough.
  Seed prod beforehand; use `/shots daily` for the daily post.
