# Requirements

> Status: **Nearly ready for system design.** All questions in ASSUMPTIONS.md are answered, and
> [USER_FLOWS.md](USER_FLOWS.md) has walked all seven flows end to end — which settled most of
> what was open here and amended a dozen assumptions along the way.
>
> **Two things remain, and they belong together:** the stack and hosting choice, and the
> in / out / next prioritisation for the ~1-day build — what is buildable in a day depends on
> what it is built on.

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
- [x] **#12 — confirmed, and amended in place.** New shot ideas from import skip change-review but still go through idea review. Approved images stay live during re-review. The photo-URL refinement, the bulk-accept rule, idempotent re-import, and the unified keep/start-over question are all folded into #12.

### B. Resolve remaining REQUIREMENTS decisions
- [x] **Step 1 — settled in USER_FLOWS Flow 2.** Batch idea review is **one card per product, posted at once**, nothing pre-selected: the 37-card volume is a *reading* cost only the approver pays one tap at a time, while the cards' real job is being individually addressable so anyone can weigh in on the few they care about. Decided cards collapse in place, priority posts first. **Slack capture of ad-hoc ideas is cut** (Part 4) — most lost ideas were for products that now get drafted options anyway, and the sheet's Shot Idea column still reaches the system on the next import.
- [x] **Step 2 — settled across USER_FLOWS Flows 1, 2 and 4.** **Batched per import:** each CSV import creates a named drop (Flow 1), which is the unit Maya's status reports on and the unit that reports itself daily while open (Flow 4). Within a batch, **ordering is priority first, then the file's own order**; decided cards collapse so the queue shrinks as it is worked (Flow 2). Priority is set by an approver, or by anyone with force-approve friction (#7). Nothing is continuous, because nothing needs to be — drops happen a handful of times a year (#2b).
- [x] **Step 4 — settled across USER_FLOWS Flows 3, 5, 6 and 7.** Candidates live in our storage, SKU-named, each recording its idea, round, model, cost, origin and **source photo version**. Only approved images get an immutable public URL and enter the per-SKU lookup; candidates are never served (#4). Photographer uploads enter the identical flow (#2, Flow 5), differing only in recorded origin.
- [x] **Step 5 — settled in USER_FLOWS Flow 3.** Approval UX inside Slack (channel settled in #2a; idea review shares it, #2b):
  - Multiple candidates in one message: **a numbered 2×2 contact sheet to triage, then full size beside the source photo to decide.** This deliberately breaks the one-tap rule used everywhere else — with QC deferred, that comparison is the only fidelity check in the system, so it should cost a tap. Triage is ~37 screens for a drop rather than ~150 to scroll.
  - ~~Reject flow: reason or not~~ — settled (Flow 3, Step 5): free to reject, required to regenerate.
  - ~~"Almost — make it warmer" refinement~~ — settled: that sentence is what `[Generate 4 more]` asks for, and `[More like the one I approved]` covers the common case without typing.
  - ~~Force-approve friction (#1)~~ — settled (Flow 3, Step 6): a required sentence saying why, posted publicly with the approval.
- [x] **Part 2 — filled in.** Every row of Maya's asks table now points at the flow that answers it.
- [x] **Part 3 extras — every item decided with a reason:**
  - [x] CSV import entry point — **settled: Slack file drop** (USER_FLOWS Flow 1, Step 1). **Must be demoed in the video.**
  - [x] Retry with rejection feedback — **kept**: free to reject, a required sentence to regenerate (Flow 3).
  - [x] Pending-decisions email digest — **deferred to Part 4** (Flow 4). Needs no web app; deferred because Slack now pushes what email was for.
  - [x] Reminders and nudges — **kept, as a dependency**: channel posts naming products, never people (Flow 4).
  - [x] Audit trail — **kept as data, no browsable surface** (Flow 4). A web data view is in Part 4.
  - [x] Updated CSV export with status and image-link columns — **kept, and promoted to load-bearing** once Drive was cut.
  - [x] **Aspect-ratio variants of approved images (#15)** — **cut to Part 4.** Square only.
- [x] **Setup / install (USER_FLOWS Flow 0).** The invite is the configuration: the channel the
  bot is invited to becomes the review channel, and the inviter becomes the **approver** by
  default (changeable at setup, and add/remove later via `/shots approvers`; the set is never
  empty, only an approver can change it, workspace admins are the escape hatch). Setup asks
  only the two questions with no safe default — who decides, and the house style. Everything
  else takes a documented default. A second invite proposes moving the review channel, which
  **only an approver** can confirm. Setup posts the per-SKU lookup base URL in the channel.
- [ ] **Stack, host, database, and object storage.** See *What the seven flows require of the stack*
  at the end of this document — the constraints are collected there. **No Google service account
  needed** now that Drive is cut.
- [ ] **Prioritize for the ~1-day build:** mark each confirmed item as in / out / next. Depends on
  the stack choice — what is buildable in a day is a function of what it is built on.

### C. Validate with real Luma generations
> **No longer blocking.** We proceed on #14a as written: `uni-1` image edit reproduces the
> product accurately in most generations, so manual review alone is manageable. Systematic
> image-quality testing moves to Part 4 (next/future) rather than gating the design.
- [ ] Record observed latency and cost per image for APPROACH.md unit economics — from the
  build's own runs, not a separate test pass.

## Who we're building for

| Person | Role | What they need from this | Hard constraints |
|---|---|---|---|
| **Ellie** | Runs product content (+ half of everything else) | Approve/reject shots fast, from her phone | Phone-first. **No new app to install.** Her pick is the decision — modelled as a configurable **approver** role (#1), so any team can install this. |
| **Maya** | Founder | See status without asking Ellie; don't waste money; 40-product drop launches with styled shots | Just rejected a dashboard tool nobody logged into |
| **Web person** | Uploads images to the site ~weekly | Know exactly which files are final, for which product | Currently has to ask in Slack; once shipped the wrong `IMG_43xx.jpg`. After a one-time integration they upload nothing — approval *is* publication (#4, Flow 7). |
| **Rest of team** | Suggest shot ideas, give opinions | Get ideas captured; weigh in | Ideas get lost in Slack today |

Existing toolkit: **Google Sheets/Docs/Drive, Slack, Gmail.** Nothing else. Of these the design uses **Slack only** — the sheet stays as an import/export format during the transition (#3a), and Drive is cut (#4).

**Definition of done (ASSUMPTIONS #5a):** the **product** is the unit — done = **2+ approved images** for that SKU, stored and served by the per-SKU lookup. "On the product page" is out of scope (#4); status ends at *approved & ready*.

> **A tension worth keeping in view (#4c):** a product page uses about **three** images, so a product can be *done* and still render one short. These are deliberately two signals — **done** is the brief's own floor and the number Maya counts; **thin gallery** is a quality nudge with a price tag that never blocks a launch. If most products settle at exactly 2, the two numbers have drifted apart and one of them should move.

## Facts that constrain the design

- **Luma image edit** (`uni-1`, `type: image_edit`): takes the white-background photo as `source` plus a prompt; keeps parts of the image the prompt doesn't mention. Up to 8 `image_ref` images. Async: submit, then poll; typically 30–60s.
- **Cost:** `uni-1` edit $0.0434/image · `uni-1-max` edit $0.1030/image (+$0.003 per extra reference image). Failed or moderated generations are refunded.
- **Output size** comes from the source image. Product photos are 2048×2048 JPEGs, so outputs are square unless we crop or use a different mode. **This makes source dimensions an invariant worth guarding:** one non-square upload silently changes the aspect ratio of everything generated for that product afterwards (#11, #15, Flow 6).
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

Settled (ASSUMPTIONS #7): Notes are context for drafting and are shown in review; they never trigger automatic rules. Priority is a manual flag; priority items sort first everywhere and are named in status reports. Setting it **follows the approval rule** — an approver in one tap, anyone else with force-approve friction.

Settled (ASSUMPTIONS #8): No special handling. Ideas are drafted for all blank products; idea review has Skip and Archive actions.

**Decision (USER_FLOWS Flows 1, 2, 4):** **B + C.** Each CSV import creates a **named drop** (Flow 1), which is the unit status reports on and the unit that reports itself daily while open (Flow 4). Within a drop, ordering is **priority first, then the file's own order**; decided cards collapse in place so the queue shrinks as it is worked (Flow 2). **A is rejected, because nothing needs to be continuous** — drops happen a handful of times a year (#2b), so a queue that is always open would be empty most of the year and is the wrong shape for how this team actually works.

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

**Decision (USER_FLOWS Flows 2 and 3):** **B.** Approving an idea starts that product's generation **immediately** — no separate "now generate" gate, because the idea gate *is* the spend gate (#3) and a second button would quietly mean the same thing. Generation takes 30–60s per image, so candidates start arriving while the idea queue is still being worked; the two overlap by design. **C is rejected:** a preview round is a third decision point for a person who already has two (#1), and at $0.0434 an image the saving does not pay for the extra tap. Replacing a source photo also generates immediately, and resets the round counter (Flow 6).

### Step 4. Candidates coming back
**Today:** Candidates arrive by email as attachments, links, or zips.
**Pain:** Scattered; hard to tie a file back to a product.

Settled (ASSUMPTIONS #2): Candidates can come from AI generation **or** a photographer upload through the Slack app. Both enter the same review flow.

Options:
- **A.** All candidates stored in one place, named by SKU and request.
- **B.** An automatic quality check before anything reaches Ellie (e.g., a vision model compares to the original photo, flags a warped product or wrong color).

**Decision (USER_FLOWS Flows 3, 5, 6, 7):** **A. B is deferred** (#14, #14a, Part 4). Candidates live in our storage, SKU-named, each recording its idea, round, model, cost, origin, and **source photo version** (#11). Only *approved* images get an immutable public URL and enter the per-SKU lookup — candidates are never served (#4). Photographer uploads enter the identical flow, differing only in recorded origin (#16). Because B is deferred, **`[Compare with source]` on the candidate message is the only fidelity check in the system**, which is why it is a first-class button rather than a detail.

### Step 5. Review and approval
**Today:** Ellie forwards favorites to Slack, and her pick is final. Picks get lost across Slack threads and email.
**Pain:** No record of decisions; approvals are hard to find.

Settled (ASSUMPTIONS #2): **Slack is the primary surface.** No email approvals.

Options for how approval looks inside Slack (was: where Ellie approves):
- **A. Slack.** Bot posts candidates in a channel/thread; she taps Approve/Reject. Team opinions happen in the thread like today.
- **B. Email (Gmail).** Candidates emailed with approve/reject links.
- **C. Google Sheet.** Thumbnails in cells, approve by dropdown or checkbox. Weak on a phone.
- **D. Mobile web page linked from Slack or email.** Nothing to install, but it's one more place to go. Risks repeating the dashboard nobody used.

Settled (ASSUMPTIONS #1): **approver** is a configurable role (default: whoever invites the bot); one tap for them, force-approve with a required sentence for anyone else; every approval records who, whether it was forced, and why; comments are optional.

Settled (ASSUMPTIONS #2a, #2b): **A. Slack, in one review channel — shared with idea review.** Candidates are public so the team can weigh in and force-approvers can find the queue. One message per request carries all of that product's candidates. Drops happen a handful of times a year, so the channel reads as a record of each drop rather than a crowded queue (#2b).

**Decision (USER_FLOWS Flow 3):**
- **Presenting candidates:** a numbered 2×2 **contact sheet to triage**, then **full size beside the source photo to decide**. This is the one place the design breaks its own one-tap rule, deliberately — with QC deferred, that comparison is the only fidelity check there is.
- **Approve per image, reject per round.** A per-image rejection carries almost no information; what matters is whether the round produced two keepers, and when it did not the fault is usually the idea (#5a).
- **Rejecting is free; spending again is not.** `[None of these]` is one tap with no reason asked — rejections are public (#2a) and justifying a taste call to the team is friction in the wrong place. `[Generate 4 more]` asks what should be different before it spends, which also answers "almost — make it warmer" and makes round two differ from round one. `[More like the one I approved]` covers the short-round case without typing.
- **Force-approve friction is a required sentence** saying why, posted publicly with the approval. A confirm dialog is friction someone in a hurry taps through; typing cannot be done absent-mindedly, and it is the only friction that *produces* something — the audit trail #1 promised is honest only if it records why.

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
- [ ] **Aspect-ratio variants of approved images (ASSUMPTIONS #15)** — **deferred to Part 4.** Core output stays square 2048×2048, which matches every source photo and is what a product page wants. Variants are an add-on to *approved* images, so no flow depends on them, and the padded-source approach is untested and now untested by choice. Trigger to build: someone asking for a crop of an approved image for social or ads.
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

Every item here is deferred **with a trigger**: a specific friction that, when observed, says
build it now. A deferred item without a trigger is just a wish, and it is how a "next" list turns
into a list nobody reads. Several of these triggers are things the system already records, so the
answer is available rather than remembered.

| Item | Why it is not in scope now | **Trigger to build it** |
|---|---|---|
| **Aspect-ratio variants of approved images** — 4:5, 9:16, 16:9 generated from an approved square image and re-approved (#15) | Square 2048×2048 matches every source photo and is what a product page wants. Variants are an add-on to *approved* images, so nothing in the seven flows depends on them, and the padded-source approach is untested — and now untested by choice | Someone asks for a crop of an approved image for social or ads. Concretely: a request that today ends with a person cropping a file by hand |
| **Systematic image-quality testing** — product accuracy on hard cases (smoke glass HG-041, multi-colour sets HG-018/HG-020), `image_ref` fidelity (#10), padded-source ratios (#15) | We proceed on #14a. Rejection rates in real use are a cheaper and more honest signal than a test pass judged against our own guesses about what "good" means | **Approvals-per-round running low** — many candidates paid for and rejected. Also required *before* changing #10's rule so multi-product images count for featured SKUs, which is the one place no human check covers |
| **Automated candidate accuracy screening** (vision-model QC before Slack) | An approver's eye is the check, and nothing automatic can wrongly hide a good image (#14) | A wrong-colour or warped product reaching approval, or the spend report showing repeated rounds rejected wholesale |
| **Robust image intake and processing** — dimensions, aspect ratio, background, resolution floors, colour profile, EXIF orientation, format conversion, padding to a canonical square source | Uploads are accepted with a plain warning about the effect (Flow 6). Refusing the only photo someone has makes a tool people work around; silently altering a product photo is the invisible change this design exists to prevent | **A non-square photo actually being uploaded.** Visible without anyone remembering, because every source version records its dimensions (#11) |
| **Automatic source-photo review and touch-up** | Colour-shift risk and false alarms on naturally dark products; manual replace covers the real cause | The same product being replaced-then-regenerated more than once — the first round came out dim and nobody could tell why until after paying for it |
| **Pending-decisions email digest** — read-only summary of what is waiting | #2 wanted email because nothing came to you; the drop's daily post and nudges now do (Flow 4). What it still uniquely covers is someone who has stopped opening Slack | **Items repeatedly force-approved** — that means the channel is not reaching the person who should be deciding, which is exactly the gap email fills |
| **Opt-in DM nudges** | Nudges name products, never people (Flow 4) — the bot should not call anyone out on a team of four, and a DM path reopens what #2a closed | Nudges posting and the item not moving — the stuck list repeating the same SKU across several days |
| **Configurable report frequency** | A drop reports itself daily while open and not at all between drops. A sensible default is less to build and more likely to reach Maya than an opt-in she must find | Anyone saying the daily post is too much or not enough |
| **Separate `#shot-ideas` channel** | Ideas and candidates share one channel because drops are a few times a year, so it reads as a record of each drop rather than a crowded queue (#2b) | **Two drops open at once**, or rounds overlapping at 300 SKUs. It is a configuration change, not a redesign |
| **Separate upload channel for freelancers** | A Slack guest in `#shot-reviews` sees every candidate, rejection and spend figure. Covered by a team member uploading on their behalf (Flow 5) | A second photographer engagement, or anyone hesitating to invite one because of what they would see |
| **Capturing a shot idea from an ordinary Slack message** | Most lost ideas were for products that now get drafted options anyway, and the sheet's Shot Idea column still reaches the system on the next import (Flow 2) | An idea appearing in a card's thread and never becoming an option — the thread is the place to look, and it is already attached to the product |
| **Request approved images from the bot** (`/shots images HG-002`, or a whole drop) | Drive's actual job without Drive. Needs no new data: every image already has a stable URL and an origin | Anyone asking in the channel where to get files for social — the brief's "which files are final?" question resurfacing in a new place |
| **Web-based data view** — read-only site over the audit trail and spend data | Beyond a one-day build. Not the dashboard this team abandoned: that asked people to go somewhere to *do their work*; this is somewhere to look something up when something is wrong | A question the CSV export cannot answer without a spreadsheet session — repeated "who approved this, and why" requests |
| **Storefront platform connector** (Shopify etc.) | Platform unknown; the per-SKU lookup covers it once integrated (#4a) | The team names their platform, or it turns out to need uploaded assets rather than external URLs |
| **Image resizing / thumbnails** | The full-size approved image is enough to start (#4a) | The web developer asking for smaller variants, or page weight becoming a complaint |
| **Scheduled seasonal swaps** — *us* deciding when a season starts | Mostly dissolved: the site asks for a theme and owns the calendar (#4b, Flow 7), so there is no scheduler, nothing to expire, and no SKU left short | The web developer asking for the lookup to switch itself — i.e. wanting us to own the calendar after all |
| **Tracking discontinued products** | Not our problem to solve; archive covers the clutter (#6) | Archive being used as a proxy for discontinued — someone asking "which of these are actually dead?" |

### Cut, not deferred

No trigger, because these are not waiting for anything.

| Item | Why |
|---|---|
| **Google Drive copy of approved images** | Storage was always canonical; the copy bought nothing the storage layer did not already do, and cost a service account, OAuth, folder config, and a copy-vs-canonical failure mode. Its human-facing job is covered by "request approved images from the bot", above |

## Non-functional requirements

- Deployed and publicly reachable; no localhost demos.
- Secrets stay out of git (`.env.local`).
- Survives restarts: request state is stored persistently.
- Keeps working as the catalog grows 10× (see APPROACH.md on unit economics).
- Persistent database is the system of record (ASSUMPTIONS #3a).

### What the seven flows require of the stack

Collected from USER_FLOWS.md, as the input to the stack decision rather than a decision itself.

| Requirement | Where it comes from |
|---|---|
| **Public HTTPS endpoint** for Slack events and interactivity, acknowledging within Slack's ~3s window and doing the real work after | Every flow |
| **Slack surface beyond posting:** buttons, modals (idea editing, upload kind, force-approve reason), **message updates in place** (decided cards collapse), threads, slash commands, and **file downloads from Slack** (CSV and images arrive as authenticated URLs) | Flows 1, 2, 3, 5, 6 |
| **Background work on two rhythms:** short polling for generations (30–60s, several in parallel), and scheduled jobs for the drop's daily post, nudge thresholds, and stuck-item detection | Flows 3, 4 |
| **Object storage with immutable public URLs**, plus a small read API on the **page-render path** — it must not fail, and its response is short-cached while the image URLs cache forever | Flow 7, #4 |
| **Server-side image compositing** for the 2×2 numbered contact sheet | Flow 3, Step 2 |
| **Writing embedded provenance metadata** into stored AI-origin images (IPTC digital source type / C2PA-style) | #16 |
| **Outbound calls:** Luma (async submit + poll), Slack, and fetching catalogue photo URLs at import | Flows 1, 3 |
| **An event log** alongside product state — two different shapes, exported separately | Flow 4, #1, #16 |
| **An LLM** for idea drafting and expansion (cents per batch, not a hot path) | #3, #9 |

**Explicitly not needed:** a web application, user accounts, a Google service account, a
scheduler that owns a campaign calendar (#4b), or any storefront credentials.
