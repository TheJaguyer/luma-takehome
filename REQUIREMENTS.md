# Requirements

> Status: **DRAFT — decisions pending.** Options below are brainstormed; nothing is decided until the **Decision** line is filled in. All 16 questions in ASSUMPTIONS.md are answered; the items below must be resolved **before system design**.

## TODO before system design

### A. Confirm details left open in ASSUMPTIONS.md
> **ASSUMPTIONS.md has been amended** to match everything settled in USER_FLOWS Flows 0 and 1.
> Revised entries are marked **[revised]** there, with the original reasoning kept and what
> changed recorded underneath: #1 (approver as a role), #2a (channel move), #3b (house style
> asked at setup), #4 (Drive cut), #6 (archive means "not right now"), #12 (rejection reserved
> for broken identity; bulk accept; idempotent re-import). The items below are what remains.
- [x] **#4 — CDN/serving defaults: confirmed and extended (USER_FLOWS Flow 7).**
  - Immutable per-version image URLs plus a per-SKU lookup. **Caching splits in two:** image URLs cache forever (immutable by construction), the lookup response caches for seconds — that split is what makes "approval = live" true in practice.
  - Slack notice and one-tap revert when a SKU's live images change, **naming which theme's set changed** ("holiday images changed, defaults unchanged") — the flat-set wording was alarming and vague once sets exist.
  - **Display order is approval order; first approved is primary; `[Make primary]` promotes any approved image** within its own theme. A promotion is a publishing action and posts the same notice and revert.
  - **Themes are a request parameter** (`?theme=holiday`), themed images first then defaults, `served_theme` says what was actually served (#4b, #4c).
  - **A well-formed request never fails** — unknown SKU, unknown theme, or no images all return 200 with a usable answer, because the lookup sits on the page-render path.
  - Resizing/thumbnails deferred. Drive is cut — see the note at the top of this section.
- [x] **#6 — Archived SKUs: settled (Flow 7 / #4b).** **Yes, they keep being served.** Archive is *our* workflow state — hidden from queues, status and drafting — not a publishing switch. The site decides independently what it lists (#4b), so a product hidden from Ellie's queue but still on the site must not lose its images. Archiving never breaks a live page.
- [x] **#7 — Priority: settled.** It follows the approval rule exactly — an approver sets it in
  one tap, anyone else can with force-approve friction (a required sentence, recorded, public).
  **One rule everywhere a decision is made:** approving an idea, approving an image, promoting an
  image to primary, and setting priority all behave identically.
- [x] **#10 — Multi-product shots: settled (Flow 3, Step 8).** Counts for the **primary SKU only**; featured SKUs get it as a related image — attached, not counted, never primary. A product is only counted on images it was the `source` for, since `image_ref` fidelity is unverified. Revisit if image-quality testing (Part 4) shows it is good.
- [ ] **#12 — Interpretation check:**
  - New shot ideas from import skip change-review but still go through idea review.
  - Approved images stay live during re-review.
  - _(The photo-URL refinement is settled and folded into #12.)_

### B. Resolve remaining REQUIREMENTS decisions
- [x] **Step 1 — settled in USER_FLOWS Flow 2.** Batch idea review is **one card per product, posted at once**, nothing pre-selected: the 37-card volume is a *reading* cost only the approver pays one tap at a time, while the cards' real job is being individually addressable so anyone can weigh in on the few they care about. Decided cards collapse in place, priority posts first. **Slack capture of ad-hoc ideas is cut** (Part 4) — most lost ideas were for products that now get drafted options anyway, and the sheet's Shot Idea column still reaches the system on the next import.
- [ ] **Step 2:** Queue model beyond the priority flag (continuous vs. batched per import; ordering).
- [x] **Step 4 — settled across USER_FLOWS Flows 3, 5, 6 and 7.** Candidates live in our storage, SKU-named, each recording its idea, round, model, cost, origin and **source photo version**. Only approved images get an immutable public URL and enter the per-SKU lookup; candidates are never served (#4). Photographer uploads enter the identical flow (#2, Flow 5), differing only in recorded origin.
- [ ] **Step 5:** Approval UX inside Slack (channel settled in #2a; idea review shares it, #2b):
  - Presenting multiple candidates in one message on a phone.
  - ~~Reject flow: reason or not~~ — settled (Flow 3, Step 5): free to reject, required to regenerate.
  - ~~"Almost — make it warmer" refinement~~ — settled: that sentence is what `[Generate 4 more]` asks for, and `[More like the one I approved]` covers the common case without typing.
  - ~~Force-approve friction (#1)~~ — settled (Flow 3, Step 6): a required sentence saying why, posted publicly with the approval.
- [ ] **Part 2:** Fill the remaining rows of Maya's asks table ("AI just make the shots", "Ellie approves on her phone", "40-product drop").
- [ ] **Part 3 extras, keep or cut each with a reason:**
  - [x] CSV import entry point — **settled: Slack file drop** (USER_FLOWS Flow 1, Step 1). **Must be demoed in the video.**
  - [ ] Retry with rejection feedback.
  - [ ] Pending-decisions email digest, and whether it needs a web app (#2; dashboard risk).
  - [ ] Reminders and nudges.
  - [ ] Audit trail (effectively required by #1 force-approve and #16 provenance; confirm scope).
  - [ ] Updated CSV export with status and image-link columns.
  - [ ] Aspect-ratio variants of approved images (#15).
- [x] **Setup / install (USER_FLOWS Flow 0).** The invite is the configuration: the channel the
  bot is invited to becomes the review channel, and the inviter becomes the **approver** by
  default (changeable at setup, and add/remove later via `/shots approvers`; the set is never
  empty, only an approver can change it, workspace admins are the escape hatch). Setup asks
  only the two questions with no safe default — who decides, and the house style. Everything
  else takes a documented default. A second invite proposes moving the review channel, which
  **only an approver** can confirm. Setup posts the per-SKU lookup base URL in the channel.
- [ ] **Non-functional:** stack, host, database, and object storage (Slack webhooks need a public URL). **No Google service account needed** now that Drive is cut.
- [ ] **Prioritize for the ~1-day build:** mark each confirmed item as in / out / next.

### C. Validate with real Luma generations
> **No longer blocking.** We proceed on #14a as written: `uni-1` image edit reproduces the
> product accurately in most generations, so manual review alone is manageable. Systematic
> image-quality testing moves to Part 4 (next/future) rather than gating the design.
- [ ] Record observed latency and cost per image for APPROACH.md unit economics — from the
  build's own runs, not a separate test pass.

## Who we're building for

| Person | Role | What they need from this | Hard constraints |
|---|---|---|---|
| **Ellie** | Runs product content (+ half of everything else) | Approve/reject shots fast, from her phone | Phone-first. **No new app to install.** Her pick is the decision. |
| **Maya** | Founder | See status without asking Ellie; don't waste money; 40-product drop launches with styled shots | Just rejected a dashboard tool nobody logged into |
| **Web person** | Uploads images to the site ~weekly | Know exactly which files are final, for which product | Currently has to ask in Slack; once shipped the wrong `IMG_43xx.jpg` |
| **Rest of team** | Suggest shot ideas, give opinions | Get ideas captured; weigh in | Ideas get lost in Slack today |

Existing toolkit: **Google Sheets/Docs/Drive, Slack, Gmail.** Nothing else.

**Definition of done (ASSUMPTIONS #5a):** the **product** is the unit — done = **2+ approved images** for that SKU, stored and served by the per-SKU lookup. "On the product page" is out of scope (#4); status ends at *approved & ready*.

## Facts that constrain the design

- **Luma image edit** (`uni-1`, `type: image_edit`): takes the white-background photo as `source` plus a prompt; keeps parts of the image the prompt doesn't mention. Up to 8 `image_ref` images. Async: submit, then poll; typically 30–60s.
- **Cost:** `uni-1` edit $0.0434/image · `uni-1-max` edit $0.1030/image (+$0.003 per extra reference image). Failed or moderated generations are refunded.
- **Output size** comes from the source image. Product photos are 2048×2048 JPEGs, so outputs are square unless we crop or use a different mode.
- All 40 photo URLs in the export are publicly reachable (checked 2026-09-12).

---

## Part 1 — The existing process, step by step

Each step: what happens today → what hurts → options → decision.

### Step 1. Capturing shot ideas
**Today:** People write ideas in the sheet's Shot Idea column (16 exist, some months old). Other ideas live only in Slack threads.
**Pain:** Ideas get lost; nobody knows which ideas are "live"; ideas are vague ("with food in it?").

Options:
- **A. Sheet stays the source.** Ideas come in through the CSV export (the brief says no live sheet sync is needed).
- **B. Slack capture.** A slash command, message shortcut, or emoji reaction turns a Slack message into a shot request.
- **C. AI-suggested ideas.** For products with no idea (most of the catalog, and all of the 40-product drop), propose ideas for Ellie to accept.
- **D. Idea cleanup.** An LLM turns a vague idea plus product data plus Notes into a concrete prompt; Ellie sees or approves the rewrite before anything is generated.

Settled (ASSUMPTIONS #3b): drafting is anchored by a **house style blurb** (written by the team at setup, editable) plus an optional **campaign theme** overlay per batch — a *named* theme (`halloween`, what the site requests) with a free-text look (what steers drafting) — which makes themed runs (Q4, Halloween, spring) a first-class action rather than a prompt-editing exercise.

Settled (ASSUMPTIONS #3, #3a):
- **A + C + D, gated.** Existing sheet ideas are imported. Products without one get 2–3 AI-drafted ideas. The team approves, edits, or replaces ideas in Slack **before** any image is generated.
- The database is the source of truth. CSV is the import/export format only.

- Existing ideas (ASSUMPTIONS #9) are expanded into 2–3 options: option 1 is a faithful rewrite of the original in the standard detailed format; options 2–3 are variations. The raw original is shown for context.

**Decision (USER_FLOWS Flow 2):** **A + C + D.** **B (Slack capture) is cut** — see Part 4. Batch idea review is one card per product, posted at once, with nothing pre-selected; the card carries the raw sheet idea, the notes verbatim, and any earlier comments, and `[Edit…]` opens the option's full text in a modal where saving also approves.

### Step 2. Building the wishlist
**Today:** Two or three times a year, Ellie rebuilds the list from the sheet, Slack, and her inbox.
**Pain:** Batched, manual, and happens rarely; this is the main bottleneck.

Options:
- **A. Continuous.** Every new idea becomes a request right away.
- **B. Batched on import.** Each CSV import creates a batch.
- **C. Queue with priority.** Priority is set by notes ("do this one first", bestseller, Q4) or chosen by Ellie.

Settled (ASSUMPTIONS #7): Notes are context for drafting and are shown in review; they never trigger automatic rules. Priority is a manual flag set by Ellie; priority items sort first everywhere and are named in status reports.

Settled (ASSUMPTIONS #8): No special handling. Ideas are drafted for all blank products; idea review has Skip and Archive actions.

**Decision:** _TBD_

### Step 3. Sending to the photographer → generation
**Today:** The wishlist goes to a freelancer; shots come back weeks later.
**Pain:** Too slow to matter.

Options:
- **A. Generate automatically** as soon as a request exists.
- **B. Generate on approval of the prompt.** Ellie approves the idea/prompt first (cheap), then images get made (costs money). ← **Settled by ASSUMPTIONS #3:** no image is generated before its idea is approved.
- **C. Preview then full batch.** Generate 1 cheap preview; if Ellie likes the direction, generate more.

Settled:
- Candidates per round and max rounds are settings (#13).
- `uni-1` by default, with `uni-1-max` selectable per product or idea (#14).
- Strict product-preservation prompt.
- No automated accuracy check; it's deferred (#14).

**Decision:** _TBD_

### Step 4. Candidates coming back
**Today:** Candidates arrive by email as attachments, links, or zips.
**Pain:** Scattered; hard to tie a file back to a product.

Settled (ASSUMPTIONS #2): Candidates can come from AI generation **or** a photographer upload through the Slack app. Both enter the same review flow.

Options:
- **A.** All candidates stored in one place, named by SKU and request.
- **B.** An automatic quality check before anything reaches Ellie (e.g., a vision model compares to the original photo, flags a warped product or wrong color).

**Decision:** _TBD_

### Step 5. Review and approval
**Today:** Ellie forwards favorites to Slack, and her pick is final. Picks get lost across Slack threads and email.
**Pain:** No record of decisions; approvals are hard to find.

Settled (ASSUMPTIONS #2): **Slack is the primary surface.** No email approvals.

Options for how approval looks inside Slack (was: where Ellie approves):
- **A. Slack.** Bot posts candidates in a channel/thread; she taps Approve/Reject. Team opinions happen in the thread like today.
- **B. Email (Gmail).** Candidates emailed with approve/reject links.
- **C. Google Sheet.** Thumbnails in cells, approve by dropdown or checkbox. Weak on a phone.
- **D. Mobile web page linked from Slack or email.** Nothing to install, but it's one more place to go. Risks repeating the dashboard nobody used.

Settled (ASSUMPTIONS #1): Ellie is the default one-tap approver; anyone can force-approve with extra friction; every approval records who approved and whether it was forced; comments are optional.

Settled (ASSUMPTIONS #2a): **A. Slack, in a dedicated review channel.** Candidates are public so the team can weigh in and force-approvers can find the queue. One message per request carries all of that product's candidates, so the 40-product drop is ~40 messages, not ~160. Discussion happens in the thread. Still open: whether idea review shares this channel.

Sub-questions: Does rejecting ask for a reason, and does that reason feed a retry ("too staged")? What about "almost — make it warmer"?

**Decision:** _TBD_

### Step 6. Filing the winners
**Today:** Winners go to a shared Drive folder with camera filenames.
**Pain:** The wrong file went live, and nobody noticed for three weeks.

Options:
- **A.** Approved images auto-upload to Drive with deterministic names (e.g., `HG-002_sage-mug_styled_01.jpg`), one folder per SKU or per batch. _(Cut.)_
- **B.** Only approved images are ever filed, so the folder is final by definition.
- **C.** Hosted image URLs instead of Drive (Drive requires Google OAuth setup).

**Decision (revised in USER_FLOWS Flow 0, Step 8):** **B + C. Drive is dropped.** Only approved images are filed, and they live in our storage, served by the per-SKU lookup with SKU-based names. Storage was always canonical; the Drive copy bought nothing the storage layer did not already do, and cost a Google service account, an OAuth path, folder config, and a class of failure where the copy and the canonical store disagree.

What covers the gap: approved images stay in the Slack approval message (a searchable archive), and the **updated CSV export with image-link columns** becomes load-bearing rather than a nice-to-have. The real replacement — **asking the bot for approved images** (`/shots images HG-002`, or a whole drop) for social and campaign use — is in Part 4 as *next*.

> **Supersedes ASSUMPTIONS #4's "A + B + C, all three."** #4 must be amended, not just annotated.

### Step 7. Publishing to the site
**Today:** The web person uploads roughly weekly, after asking in Slack which files are final.
**Pain:** Guesswork.

Options:
- **A.** A weekly (or on-demand) Slack digest: "N products ready to publish" with files and links.
- **B.** A column in the updated CSV export for ready-to-publish images.
- **C.** The web person marks a product "published" so the request reaches **done**.

Note: We have no site integration, so "on the product page" can't be verified automatically.

**Decision (ASSUMPTIONS #4, #4a, #4b, #4c — detailed in USER_FLOWS Flow 7):** Publishing to the storefront is out of scope. Instead:
- A **per-SKU image lookup** that the web developer integrates once. After that, approved images reach the site with no manual upload.
- Immutable, unique URL per image version; display order is approval order, first approved is primary, promotable with `[Make primary]`.
- **The site asks by SKU and optionally by theme.** It already knows which SKUs it lists (#4b), and it owns the calendar — so `?theme=holiday` returns holiday images first then defaults, and February simply stops asking. This is what makes seasonal swapping need no scheduler on our side.
- Approval changes what's live, so each live change posts to Slack naming the theme set, with a one-tap **revert**.
- Status ends at "approved & ready." A storefront connector and image resizing are "next."

---

## Part 2 — Maya's asks, traced

| Ask | Covered by | Decision |
|---|---|---|
| "AI just make the shots people put in the sheet" | Steps 1–3 | Sheet ideas import and are expanded into 2–3 concrete options (#9); blank products get three drafted (#3). Nothing generates until an idea is approved (USER_FLOWS Flows 1–2) |
| "Ellie approves them on her phone somehow" | Step 5 | Slack, one card per product, contact sheet to triage and full size beside the source photo to decide. One tap to reject a round; a sentence required only to spend again (USER_FLOWS Flow 3) |
| "Don't burn our budget on stuff she'll reject" | Steps 3–4 (gating, previews, QC) | Idea approval before any image (#3); per-product round limits, spend visibility, warning thresholds, spend comparison reports (#13). QC TBD (#14) |
| "See where things stand without having to ask Ellie" | Status surface, see Part 3 | `/shots status` at three zoom levels, **plus the drop reporting itself** — start, daily while open, completion — so she never has to remember to ask. Stuck items are grouped by who they wait on, including the "waiting on nobody" case that appears in no queue (USER_FLOWS Flow 4) |
| "40-product drop… launch with styled shots" | CSV import + idea generation | Drop the CSV in Slack; it becomes a named drop with a campaign theme asked once, ~37 drafted ideas, then candidates arriving about a minute after each idea approval. Progress and spend per drop via `/shots status <drop>` (USER_FLOWS Flows 1–3, #2b) |

## Part 3 — Extras and quality-of-life candidates

To keep or cut. Each needs a reason either way.

- [x] **Approved-image counts per SKU, split by theme (ASSUMPTIONS #4c, USER_FLOWS Flows 4 and 7).** A flat total stopped being enough once the lookup groups by theme. Status reports the split per product and a "would show a thin gallery" count with the cost of filling it. **Thin is a separate signal from done:** done is 2+ (#5a, Maya's number), a page uses about 3 (#4c), so a product can be done and still render one short — a nudge with a price tag, never a blocker.
- [x] **Status for Maya (ASSUMPTIONS #5, USER_FLOWS Flow 4).** On-demand Slack command at overall, drop, and SKU level, showing stage counts, spend, and stuck items. **A drop also reports itself** — import summary, a daily post while open, a completion post — and nothing between drops. Spend comparisons live in their own `/shots spend`, where the per-drop breakdown and "most spent on one product" carry more signal than a calendar comparison (#2b, #13).
- [x] **Launch-drop tracking**, covered by the drop-level status above ("32/40 done, 5 awaiting Ellie, 3 in generation") — and by the drop's own daily post while it is open.
- [x] **Budget guardrails (ASSUMPTIONS #13).**
  - Per-product candidates-per-round and max-rounds settings.
  - Cost tracked per generation.
  - Optional weekly/monthly/annual warning thresholds, posted to Slack; no hard stop.
  - Spend report comparing week-over-week and month-over-month (and longer), available on demand and scheduled.
- [x] **New CSV import path (USER_FLOWS Flow 1).** **Slack file drop:** the CSV is dragged into the review channel and the bot picks up the attachment. No command, no page to visit; the video demo is one gesture. Email and web upload rejected — a web form repeats the abandoned-dashboard shape. `/shots import <url>` is additive and deferred.
- [x] **Import merge rules (ASSUMPTIONS #12).**
  - Tolerant validation, reporting rejected rows.
  - New SKUs are created.
  - Detail and photo changes to existing SKUs need a side-by-side accept.
  - New ideas go straight to idea review.
  - Blanks never erase.
  - An accepted change on a SKU with approved images triggers re-review (images stay live meanwhile).
- [x] **Handling Notes (ASSUMPTIONS #7).** Context only: fed into idea drafting and shown in review. No automatic parsing.
- [x] **Priority flag (ASSUMPTIONS #7).** Set by Ellie; top of every queue and list; called out in status and scheduled reports.
- [x] **Multi-product scenes (ASSUMPTIONS #10).** Group multiple SKUs into one shot: the primary SKU is the edit source, featured SKUs go in as `image_ref`. Easy grouping in idea review (Flow 2, Step 6). **Counts for the primary only** (Flow 3, Step 8); featured SKUs get it as a related image. Fidelity test is in Part 4.
- [x] **Retry with feedback (USER_FLOWS Flow 3, Step 5).** **Rejecting is free; spending again is not.** `[None of these]` is one tap with no reason asked — rejections are public (#2a) and justifying a taste call in front of the team is friction in the wrong place. `[Generate 4 more]` asks what should be different before it spends, so the friction lands on the money (#13) at the one moment a sentence of typing is obviously worth it. The text joins the next round's prompt and is recorded on the round. `[More like the one I approved]` is offered when one exists; `[Try a different idea]` needs no reason at all.
- [x] **Photographer upload (ASSUMPTIONS #2, USER_FLOWS Flow 5).** Drop the photo in the channel; the bot asks which product and which kind — a finished shot for review, or a new source photo — each described by what it does next rather than by name. Shots enter the normal approval flow with `origin: photographer` and the AI question asked, never inferred (#16). **Two routes for a freelancer:** invite them as a channel guest, or have a team member upload on their behalf — the second is the default recommendation, since a guest sees every candidate, rejection and spend figure. A separate upload channel is in Part 4.
- [x] **Pending-decisions email digest — deferred to Part 4 (USER_FLOWS Flow 4).** Designed, not built. It needs no web app: it is a read-only summary of data this flow already assembles. The reason for deferring is that email was going to be "the thing that comes to you", and the drop's daily post plus nudges now do that inside Slack. It still uniquely reaches someone who has stopped opening Slack — build it when items start being force-approved repeatedly.
- [x] **Archive SKUs (ASSUMPTIONS #6).** Hide a product from queues, status, and idea drafting without deleting it; restorable. **Archive means "not right now," not "dead"** — an import containing an archived SKU unarchives it (USER_FLOWS Flow 1). Open: do archived products' approved images keep being served by the CDN lookup?
- [ ] **Aspect-ratio variants of approved images (ASSUMPTIONS #15).** Request 4:5 / 9:16 / 16:9 for an approved square image; generate (padded source) and re-approve; served alongside the square. Core output stays square 2048×2048. Padding approach untested.
- [x] **AI provenance (ASSUMPTIONS #16).**
  - Every image stores origin (`ai` / `photographer`) plus model and source version.
  - Manual uploads have an "AI-generated?" marker.
  - `origin` is exposed in the CDN lookup.
  - AI-origin files carry embedded AI-generation metadata.
  - How to disclose it to shoppers is the team's call.
- [x] **Reminders and nudges (USER_FLOWS Flow 4, Step 6).** **Dependency, not an extra (ASSUMPTIONS #5a).** Posted in the channel, naming **products, not people** — no `@`-mentions, no DM path. At most one post a day listing everything past the threshold; nothing posts when nothing is stuck. The stuck list is organised by *who it waits on*, and the category that matters is **waiting on nobody** (a product at 1-of-2), which appears in no queue anywhere else. Short rounds wait for a person, so a SKU at 1-of-2 approved is blocked on nobody and sits in no queue — nudges and the stuck-item list are the only things that surface it. Ping when candidates have waited more than N days, when a product is short of its 2, or when a drop deadline is at risk.
- [x] **Replace source photo (ASSUMPTIONS #11, USER_FLOWS Flow 6).** Per-SKU upload in Slack; versioned; originals kept. **Replacing generates a new round immediately** (cost on the button) and **resets the round counter**, since a different source is not the same thing #13's max-rounds limit exists to prevent. If the SKU already has approved images, it asks **keep them** or **start over** — the same question an accepted CSV photo change now asks (#12), unifying the two roads. Non-square photos are accepted with a plain warning that output size comes from the source (#15).
- [x] **Audit trail (USER_FLOWS Flow 4).** Recorded and exported, **no browsable surface**. Captures: who approved each idea and image, when, whether forced and the reason given; who accepted each import change; who triggered each generation with model, round and cost; origin and source photo version; the campaign theme per idea; every live-image change and revert. Nobody browses an audit trail until something is wrong, and the questions asked then are already answered inline — a forced approval shows its reason where it appears, and the live-change notice names who approved. The product export carries current state and last approver; the full event log exports separately. A web data view is in Part 4.
- [x] **Updated CSV export** with status and image-link columns. **Promoted from nice-to-have:** with Drive cut (Flow 0, Step 8), this is the only bulk way to hand someone every approved image link.

## Part 4 — Out of scope / future

Explicitly deferred, with the reason recorded in ASSUMPTIONS.md.

| Item | Why deferred | Source |
|---|---|---|
| Storefront platform connector (Shopify etc.) | Platform unknown; per-SKU CDN lookup covers it once integrated | #4a |
| Capturing a shot idea from an ordinary Slack message (message shortcut or emoji) | The brief names "ideas get lost in Slack", but most lost ideas were for products that now get 2–3 drafted options regardless, and the sheet's Shot Idea column still reaches the system on the next import. What is genuinely lost is the *specific* idea carrying knowledge the data lacks — recoverable via the sheet or a card's thread | Flow 2, REQUIREMENTS Step 1 option B |
| **Separate upload channel for freelancers** — a second channel the bot watches, where an outside photographer sees only their own uploads | A Slack guest in `#shot-reviews` sees every product's candidates, every rejection, the team's discussion and the spend — a lot of a small company's inner workings for someone shooting four products. Covered for now by a team member uploading on their behalf, which costs one step and exposes nothing. Right answer for a team that uses photographers regularly | #2, #2a, Flow 5 Step 3 |
| **Robust image intake and processing** — validating and normalising uploads: dimensions, aspect ratio, background, resolution floors, colour profile, EXIF orientation, format conversion, and padding or cropping to a canonical square source | Uploads are accepted as-is with a plain warning about the effect (Flow 6, Step 4), because refusing the only photo someone has makes a tool people work around, and silently altering a product photo is the invisible change this design exists to prevent. **Signal to build it:** non-square photos actually being uploaded — visible because each source version records its dimensions | #15, #11, Flow 6 |
| **Web-based data view** — a read-only site over the audit trail and spend data: product timelines, filtering, rejection and spend patterns over time | Genuinely powerful and beyond a one-day build. Distinct from the dashboard this team abandoned: that one asked people to go somewhere to *do their work*; this is somewhere to *look something up when something is wrong* — a visit measured in times per year. Nothing in the daily path depends on it | Flow 4, #1, #16 |
| **Pending-decisions email digest** — read-only summary of what is waiting, daily or at a chosen frequency | Designed (Flow 4), not built. #2 wanted email because nothing came to you; the drop's daily post and nudges now do. What it still uniquely covers is the person who has stopped opening Slack — Ellie genuinely away, the scenario force-approve exists for. **Build it when** items are repeatedly force-approved, which means the channel is not reaching the decider | #2, Flow 4 |
| Configurable report frequency (daily or weekly, per person or per install) | A drop reports itself daily while open and not at all between drops (Flow 4, Step 8). A sensible default is less to build and more likely to reach Maya than an opt-in she has to find; make it configurable when someone complains | #5, Flow 4 Step 8 |
| **Opt-in DM nudges** — a person choosing to have their own waiting items pushed to them privately | Nudges post in the channel and name products, never people (Flow 4, Step 6): the bot should not call anyone out on a team of four. A DM path also reopens what #2a closed, so the channel version should be shown insufficient first | #2a, Flow 4 Step 6 |
| Separate `#shot-ideas` channel | Ideas and candidates share one channel because drops happen a handful of times a year, so the channel reads as a record of each drop rather than a crowded queue. Revisit if drops become frequent or rounds start overlapping at 300 SKUs — it is a configuration change, not a redesign | #2b, Flow 2 Step 0 |
| **Request approved images from the bot** (`/shots images HG-002`, or a whole drop) — the human-facing way to grab approved files for social, marketing, or the Q4 campaign | The replacement for Drive's actual job, without Drive. Deferred from the ~1-day build, not from the design: every image is already stored with a stable URL and an origin, so this is a command over data that exists | Flow 0 Step 8, #4, #16 |
| Google Drive copy of approved images | **Cut, not deferred.** Storage was always canonical; the copy bought nothing and cost a service account, OAuth, folder config, and a copy-vs-canonical failure mode | Flow 0 Step 8, revises #4 |
| Image resizing / thumbnails | Full-size approved image is enough to start | #4a |
| Tracking discontinued products | Not our problem to solve; archive covers clutter | #6 |
| Automatic source-photo review and touch-up | Color-shift risk, false alarms on dark products; manual replace covers it | #11 |
| Automated candidate accuracy screening (vision-model QC before Slack) | Ellie's approval is the check for now; revisit if spend or rejection rates justify it, or if 14a proves false | #14, #14a |
| **Systematic image-quality testing** — product accuracy on hard cases (smoke glass HG-041, multi-colour sets HG-018/HG-020), featured-product fidelity via `image_ref` (#10), and the padded-source approach for non-square ratios (#15) | We proceed assuming `uni-1` output is high quality (#14a). Rejection rates in real use are a cheaper and more honest signal than a test pass run against our own guesses about what "good" means. Revisit if approvals-per-round run low, or before relying on featured-product fidelity | #14a, #10, #15 |
| Scheduled seasonal swaps (campaign sets with date windows) | Needs a scheduler and a set-aware lookup; a campaign end-date reminder plus one-tap revert covers the risk for now. Campaign is recorded per image, so this needs no migration later | #3b |

## Non-functional requirements

- Deployed and publicly reachable; no localhost demos.
- Secrets stay out of git (`.env.local`).
- Survives restarts: request state is stored persistently.
- Keeps working as the catalog grows 10× (see APPROACH.md on unit economics).
- Persistent database is the system of record (ASSUMPTIONS #3a). _TBD: stack, host, which database_
