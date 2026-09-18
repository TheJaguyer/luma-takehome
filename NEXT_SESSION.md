# What's left

> Working document. Everything here is unfinished; everything finished has moved into the
> permanent docs. Delete this before submitting.

The build, the refinement pass and the documentation are done. **Two deliverables remain**, and
they are the two the brief weighs most heavily.

---

## 1. APPROACH.md — not started

The brief asks for five things. Every one of them already exists somewhere in this repo, so this
is assembly and judgement, not research. **Do not write it from memory — quote the docs.**

| What the brief asks for | Where the material is |
|---|---|
| What you built and why | REQUIREMENTS *Part 5 — In the spine* and *In — the two deliberate additions*; each flow's opening *Goal* |
| Key decisions and tradeoffs | ASSUMPTIONS, all 16, each with the question, the assumption and what it changed; USER_FLOWS' numbered decisions (1.1–1.7, 2.3, 3.1, 3.2, 5.1, 6.1, 6.2, 7.1, 7.2) |
| **The road not taken** | REQUIREMENTS *What was rejected, and what it would have cost* — two independent stacks, Python, Railway/Fly/Render, Kubernetes, external S3, SQS, distributed OAuth — plus each flow's *Rejected:* notes and *What this flow deliberately does not do* |
| **Scope ledger** | REQUIREMENTS Part 5 (*In*, *Next* with triggers, *Built after the plan*) and Part 4 (*Out*, with triggers). Already written as in/out/next with reasoning — mostly needs compressing, not composing |
| **Unit economics** | REQUIREMENTS section C, now closed: **$0.0905 per approved image** at a 50% first-round approval rate; $0.0434 and 62–69s per generation; $0.005–0.007 and 6–9s per product for drafting; a round of 4 ≈ $0.17 and ~72s |

**The four things it must say that are not yet written down as prose:**

1. **What one approved image costs, and what changes at 10×.** The number is $0.0905, and the
   sentence that matters is *the approval rate is the whole number* — generation is 96% of the
   cost, and you pay for two to keep one. At 10× (300 → 3,000 products), Luma's 10-in-flight cap
   (#13a) is ~9 images a minute, so a full drop is hours rather than minutes → Provisioned
   Throughput or a higher tier; and the single worker → pg-boss.
2. **What breaks first.** Luma concurrency (#13a); the single-replica worker (it counts free slots
   and posts the daily run, so a second copy double-posts); one disk on one box (Postgres +
   Garage); notifications lost to in-place message edits (Flow 3, Step 1's signal); Slack rate
   limits posting 40+ cards.
3. **What you'd watch after it ships** — the standing signals, which are also the triggers in
   Parts 4 and 5: forced approvals climbing (#1 — the approver set is too small, not the friction
   too high); products sitting at exactly 2 images (#4c vs #5a); the review pile at full-catalogue
   scale (#8); AI-provenance metadata auto-labelling social posts before Q4 (#16 — *Maya should
   confirm what applies*); candidates reaching the stuck list while the approver was active
   (Flow 3, Step 1, revised); **the approval rate itself**, since it sets the unit cost.
4. **The way in**, which the brief asks for explicitly: link `INSTALL.md`, and say plainly that the
   deployed app is single-workspace — reviewers are invited into the workspace, or they deploy
   their own. The reasoning is in `INSTALL.md`'s closing section and REQUIREMENTS Part 4
   (*Tenancy model*).

---

## 2. Video — not recorded

`video.md` is still the placeholder. ~8 minutes, two parts.

**First 3 minutes — for this team, in their language.** No jargon, no architecture. The spine,
live on the deployed bot: drop a CSV → ideas appear → approve one on a phone → candidates come
back → approve one → it is live on the product lookup → `/shots status`.

**Then the engineering walkthrough:** architecture, the decisions, what is next.

**Before recording:**

- [ ] Seed prod so there is history to show, not an empty channel. `data/samples/short.csv` is
      ~$0.90 for a full pass.
- [ ] `STUCK_AFTER_MINUTES=5` in the prod `.env`, so the stuck list and nudges have something in
      them. `/shots daily` posts the 9am report on demand — a cron cannot be waited for on camera.
- [ ] Decide whether to show Flow 5/6 (drop a photo → the fork). It is the most surprising thing
      in the product and costs 20 seconds.
- [ ] Set the app icon on the prod app — `slack/icon/README.md`. The bot appears in every frame.

---

## Small, optional, and genuinely deferred

Each is already written down in the permanent docs with a trigger; none blocks a submission.

| | Where it is recorded |
|---|---|
| `[Make primary]` (~30 min) | REQUIREMENTS Part 5 *Next*; USER_FLOWS Flow 7, Step 5 |
| `/shots style` "suggest one from your existing shot ideas" | USER_FLOWS Flow 0, Step 3 |
| `[Nudge an approver instead]` beside force-approve | USER_FLOWS Flow 3, Step 6 |
| Flow 6's *retire the older images* prompt after a start-over | USER_FLOWS Flow 6, Step 4 |
| `/shots approvers`, import change-review, archive, budget thresholds | REQUIREMENTS Part 5 *Next* |

## Known rough edges, accepted

- After either reset, old Slack messages keep buttons pointing at deleted rows. They do nothing
  and log an error. Use a fresh channel for a clean demo.
- `.env.production` predates `make-prod-env.sh` gaining the S3 key lines, so prod runs on the weak
  Compose defaults for `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`. Garage's S3 port is not
  publicly routed. **Append the two lines by hand — regenerating the file would mint a new
  `POSTGRES_PASSWORD`, which Postgres only reads when the volume is first initialised.**
- One Slack app serves both local and prod, so only one can be live at a time.
  `deploy/slack-mode.sh status` says which.
