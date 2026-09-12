# Requirements

> Status: **DRAFT — decisions pending.** Options below are brainstormed; nothing is decided until the **Decision** line is filled in. All 16 questions in ASSUMPTIONS.md are answered; the items below must be resolved **before system design**.

## TODO before system design

### A. Confirm details left open in ASSUMPTIONS.md
- [ ] **#4 — CDN/serving defaults** (suggested, not confirmed):
  - Immutable per-version image URLs plus a per-SKU lookup.
  - Slack notice and one-tap revert when a SKU's live images change.
  - Image display order with a primary image.
  - Resizing/thumbnails deferred.
- [ ] **#6 — Archived SKUs:** does the CDN lookup keep serving their approved images? (Suggested default: yes, so archiving never breaks a live page.)
- [ ] **#7 — Priority:** only Ellie can set it, or anyone (consistent with force-approve in #1)?
- [ ] **#10 — Multi-product shots:** does an image count toward each featured SKU's 2–3 approved images, and does it appear in each featured SKU's CDN lookup or only the primary's?
- [ ] **#12 — Interpretation check:**
  - New shot ideas from import skip change-review but still go through idea review.
  - Approved images stay live during re-review.

### B. Resolve remaining REQUIREMENTS decisions
- [ ] **Step 1:** Slack capture of ad-hoc ideas (e.g., turning a Slack message into a request)? What does batch idea review look like on a phone for a 40-product drop?
- [ ] **Step 2:** Queue model beyond the priority flag (continuous vs. batched per import; ordering).
- [ ] **Step 4:** Candidate storage and naming (SKU/request-based); photographer uploads enter the same flow (#2).
- [ ] **Step 5:** Approval UX inside Slack:
  - Presenting multiple candidates on a phone.
  - Reject flow: reason or not.
  - "Almost — make it warmer" refinement.
  - Force-approve friction (#1).
- [ ] **Part 2:** Fill the remaining rows of Maya's asks table ("AI just make the shots", "Ellie approves on her phone", "40-product drop").
- [ ] **Part 3 extras, keep or cut each with a reason:**
  - [ ] CSV import entry point (Slack file drop / email / web upload). **Must be demoed in the video.**
  - [ ] Retry with rejection feedback.
  - [ ] Pending-decisions email digest, and whether it needs a web app (#2; dashboard risk).
  - [ ] Reminders and nudges.
  - [ ] Audit trail (effectively required by #1 force-approve and #16 provenance; confirm scope).
  - [ ] Updated CSV export with status and image-link columns.
  - [ ] Aspect-ratio variants of approved images (#15).
- [ ] **Non-functional:** stack, host, database, and object storage (Slack webhooks need a public URL; Drive needs a Google service account).
- [ ] **Prioritize for the ~1-day build:** mark each confirmed item as in / out / next.

### C. Validate with real Luma generations (~$0.50) before locking the design
- [ ] **#14a — Product accuracy of `uni-1` image edit.** Hard cases:
  - Smoke glass HG-041.
  - Multi-color sets HG-018 / HG-020.
  - A simple baseline, e.g., HG-002.
  
  If poor, automated QC or a `uni-1-max` default may return to scope.
- [ ] **#10 — Featured-product accuracy via `image_ref`**, e.g., HG-011 throw + HG-002 mug, or HG-034 soap dispenser + HG-035 towel.
- [ ] **#15 — Padded-source approach for non-square ratios** (4:5, 9:16, 16:9).
- [ ] Record observed latency and cost per image for APPROACH.md unit economics.

## Who we're building for

| Person | Role | What they need from this | Hard constraints |
|---|---|---|---|
| **Ellie** | Runs product content (+ half of everything else) | Approve/reject shots fast, from her phone | Phone-first. **No new app to install.** Her pick is the decision. |
| **Maya** | Founder | See status without asking Ellie; don't waste money; 40-product drop launches with styled shots | Just rejected a dashboard tool nobody logged into |
| **Web person** | Uploads images to the site ~weekly | Know exactly which files are final, for which product | Currently has to ask in Slack; once shipped the wrong `IMG_43xx.jpg` |
| **Rest of team** | Suggest shot ideas, give opinions | Get ideas captured; weigh in | Ideas get lost in Slack today |

Existing toolkit: **Google Sheets/Docs/Drive, Slack, Gmail.** Nothing else.

**Definition of done (per request):** 2–3 approved images matching the shot idea, in the Drive folder, on the product page.

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

Settled (ASSUMPTIONS #3, #3a):
- **A + C + D, gated.** Existing sheet ideas are imported. Products without one get 2–3 AI-drafted ideas. The team approves, edits, or replaces ideas in Slack **before** any image is generated.
- The database is the source of truth. CSV is the import/export format only.

- Existing ideas (ASSUMPTIONS #9) are expanded into 2–3 options: option 1 is a faithful rewrite of the original in the standard detailed format; options 2–3 are variations. The raw original is shown for context.

Still open: Slack capture of ad-hoc ideas (B); what the batch idea-review UX looks like.

**Decision:** _Partially settled; see above_

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

Sub-questions: Does rejecting ask for a reason, and does that reason feed a retry ("too staged")? What about "almost — make it warmer"?

**Decision:** _TBD_

### Step 6. Filing the winners
**Today:** Winners go to a shared Drive folder with camera filenames.
**Pain:** The wrong file went live, and nobody noticed for three weeks.

Options:
- **A.** Approved images auto-upload to Drive with deterministic names (e.g., `HG-002_sage-mug_styled_01.jpg`), one folder per SKU or per batch.
- **B.** Only approved images are ever filed, so the folder is final by definition.
- **C.** Hosted image URLs instead of Drive (Drive requires Google OAuth setup).

**Decision (ASSUMPTIONS #4):** **A + B + C, all three.** Only approved images are filed. They go to Drive with SKU-based names **and** are served from our storage as a CDN. Storage is canonical; Drive is a copy for humans.

### Step 7. Publishing to the site
**Today:** The web person uploads roughly weekly, after asking in Slack which files are final.
**Pain:** Guesswork.

Options:
- **A.** A weekly (or on-demand) Slack digest: "N products ready to publish" with files and links.
- **B.** A column in the updated CSV export for ready-to-publish images.
- **C.** The web person marks a product "published" so the request reaches **done**.

Note: We have no site integration, so "on the product page" can't be verified automatically.

**Decision (ASSUMPTIONS #4, #4a):** Publishing to the storefront is out of scope. Instead:
- A **per-SKU image lookup** that the web developer integrates once. After that, approved images reach the site with no manual upload.
- Immutable, unique URL for each image version. Display order with a primary image.
- Approval changes what's live, so each live change posts to Slack with a one-tap **revert**.
- Status ends at "approved & ready." A storefront connector and image resizing are "next."

---

## Part 2 — Maya's asks, traced

| Ask | Covered by | Decision |
|---|---|---|
| "AI just make the shots people put in the sheet" | Steps 1–3 | _TBD_ |
| "Ellie approves them on her phone somehow" | Step 5 | _TBD_ |
| "Don't burn our budget on stuff she'll reject" | Steps 3–4 (gating, previews, QC) | Idea approval before any image (#3); per-product round limits, spend visibility, warning thresholds, spend comparison reports (#13). QC TBD (#14) |
| "See where things stand without having to ask Ellie" | Status surface, see Part 3 | On-demand Slack status command (overall / drop / SKU); optional scheduled delivery (ASSUMPTIONS #5) |
| "40-product drop… launch with styled shots" | CSV import + idea generation | _TBD_ |

## Part 3 — Extras and quality-of-life candidates

To keep or cut. Each needs a reason either way.

- [x] **Status for Maya (ASSUMPTIONS #5).** On-demand Slack command at overall, drop, and SKU level, showing stage counts, spend, and stuck items. The same report can optionally be scheduled daily or weekly.
- [x] **Launch-drop tracking**, covered by the drop-level status above ("32/40 done, 5 awaiting Ellie, 3 in generation").
- [x] **Budget guardrails (ASSUMPTIONS #13).**
  - Per-product candidates-per-round and max-rounds settings.
  - Cost tracked per generation.
  - Optional weekly/monthly/annual warning thresholds, posted to Slack; no hard stop.
  - Spend report comparing week-over-week and month-over-month (and longer), available on demand and scheduled.
- [ ] **New CSV import path.** Options: upload to Slack (drop the file in a channel), email the CSV, or a web upload form. _Entry point TBD._
- [x] **Import merge rules (ASSUMPTIONS #12).**
  - Tolerant validation, reporting rejected rows.
  - New SKUs are created.
  - Detail and photo changes to existing SKUs need a side-by-side accept.
  - New ideas go straight to idea review.
  - Blanks never erase.
  - An accepted change on a SKU with approved images triggers re-review (images stay live meanwhile).
- [x] **Handling Notes (ASSUMPTIONS #7).** Context only: fed into idea drafting and shown in review. No automatic parsing.
- [x] **Priority flag (ASSUMPTIONS #7).** Set by Ellie; top of every queue and list; called out in status and scheduled reports.
- [x] **Multi-product scenes (ASSUMPTIONS #10).** Group multiple SKUs into one shot: the primary SKU is the edit source, featured SKUs go in as `image_ref`. Easy grouping in idea review. Needs a fidelity test. Open: does it count toward, and appear in, featured SKUs' image sets?
- [ ] **Retry with feedback.** A rejection reason feeds back into the next prompt.
- [x] **Photographer upload (from ASSUMPTIONS #2).** A Slack action to attach human-shot photos to a request; the freelancer is invited to the channel when needed; shots enter the normal approval flow.
- [ ] **Pending-decisions email digest (from ASSUMPTIONS #2, design TBD).** Daily or user-set frequency; summarizes Slack state; read-only. Open question: does this need a web app? Watch the "dashboard nobody logged into" risk: an email that comes to them is different from a page they have to visit.
- [x] **Archive SKUs (ASSUMPTIONS #6).** Hide a product from queues, status, and idea drafting without deleting it; restorable. Open: do archived products' approved images keep being served by the CDN lookup?
- [ ] **Aspect-ratio variants of approved images (ASSUMPTIONS #15).** Request 4:5 / 9:16 / 16:9 for an approved square image; generate (padded source) and re-approve; served alongside the square. Core output stays square 2048×2048. Padding approach untested.
- [x] **AI provenance (ASSUMPTIONS #16).**
  - Every image stores origin (`ai` / `photographer`) plus model and source version.
  - Manual uploads have an "AI-generated?" marker.
  - `origin` is exposed in the CDN lookup.
  - AI-origin files carry embedded AI-generation metadata.
  - How to disclose it to shoppers is the team's call.
- [ ] **Reminders and nudges.** Ping Ellie when candidates have waited more than N days, or when launch is at risk.
- [x] **Replace source photo (ASSUMPTIONS #11).** Per-SKU upload in Slack; versioned; originals kept.
- [ ] **Audit trail.** Who approved what, and when, for each image.
- [ ] **Updated CSV export** with status and image-link columns.

## Part 4 — Out of scope / future

Explicitly deferred, with the reason recorded in ASSUMPTIONS.md.

| Item | Why deferred | Source |
|---|---|---|
| Storefront platform connector (Shopify etc.) | Platform unknown; per-SKU CDN lookup covers it once integrated | #4a |
| Image resizing / thumbnails | Full-size approved image is enough to start | #4a |
| Tracking discontinued products | Not our problem to solve; archive covers clutter | #6 |
| Automatic source-photo review and touch-up | Color-shift risk, false alarms on dark products; manual replace covers it | #11 |
| Automated candidate accuracy screening (vision-model QC before Slack) | Ellie's approval is the check for now; revisit if spend or rejection rates justify it, or if 14a proves false | #14, #14a |

## Non-functional requirements

- Deployed and publicly reachable; no localhost demos.
- Secrets stay out of git (`.env.local`).
- Survives restarts: request state is stored persistently.
- Keeps working as the catalog grows 10× (see APPROACH.md on unit economics).
- Persistent database is the system of record (ASSUMPTIONS #3a). _TBD: stack, host, which database_
