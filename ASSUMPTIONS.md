# Assumptions

Questions I'd ask the team if I could, the assumption I proceeded on instead, and what that assumption changed about what I built.

> Status: **All 16 initial questions answered.** Some details are flagged for confirmation during REQUIREMENTS review.

Format for each entry:
- **Question:** what I'd ask
- **Assumption:** what I went with
- **Why:** the evidence from the brief or data
- **What it changed:** the concrete effect on the build

---

## Workflow and people

### 1. Is Ellie the only approver, or can others approve?
- **Assumption:** Ellie is the normal final say, but the role isn't formally defined. Anyone on the team can **force-approve** when Ellie is unavailable. Anyone can comment, and comments are optional (they never block approval).
- **Why:** The brief says "her pick is the decision; there's no other approval step," but it describes the process as reconstructed habit, not written policy. Ellie also runs "half of everything else," and a 40-product drop with a deadline can't stall because she's out for a week.
- **What it changed:**
  - Approval is fast and one tap for Ellie; she is the default approver.
  - Others get a separate, deliberate "force approve" action rather than the same button. It takes more friction than Ellie's approve, so it stays the exception.
  - Every approval records **who** approved and whether it was forced, so Ellie can see what was decided without her and the audit trail stays honest.
  - Comments are optional and are never a required step in the flow.
  - **The same rule applies at both decision points** — idea approval and image approval (#3). One rule to learn, and Ellie stays the taste filter at the moment spend begins, which is exactly Maya's "don't burn our budget on stuff she'll reject."
  - **Cost:** the 40-product drop needs ~40 idea approvals *and* up to 40 image approvals from the person who also runs half of everything else. That makes **batch idea review load-bearing, not a nice-to-have** (#3): a screen of drafted ideas has to clear in a handful of taps, not forty. This is the first place the design strains under the drop, and the first thing to watch after it ships.

### 2. Which tool does Ellie actually live in on her phone: Slack or Gmail?
- **Assumption:** **Slack is primary.** Email was only in the loop because the photographer was an outside party. With AI generation, the photographer is usually unnecessary, so email drops out of the approval path.
- **Why:** Opinions, 👍 requests, and the web person's "which files are final?" questions all happen in Slack. The approvals that got "buried" in email were buried there *because* of the photographer thread.
- **What it changed:**
  - Approval, discussion, and status all live in a Slack app. No email-based approval.
  - **Photographer escape hatch:** the Slack app accepts human-shot photos uploaded against a request. A freelancer can be added to the channel when one is used, and their shots go through the same approval flow as AI candidates.
  - **Email as a digest only (to be designed):** a daily email, or one at a frequency the user picks, summarizing pending decisions, built from the same data. It's a summary and nudge, not a place to act, so Slack stays the single place decisions happen.

#### 2a. Which Slack channel do candidate images land in?
- **Assumption:** A **dedicated review channel** (e.g. `#shot-reviews`), separate from the team's general channel. Candidates post there in the open, the team can weigh in before Ellie decides, and Ellie approves in-channel. Approvals and live-image changes (#4) post to the same channel.
- **Why:** This team's decisions are already public: ideas get 👍'd in Slack, opinions happen in threads, and Ellie forwards favorites for comment today. Keeping candidates visible preserves that, and it gives force-approvers (#1) somewhere to look when Ellie is away — a DM-to-Ellie design would hide the queue from everyone else. A *separate* channel is what stops ~160 candidate images during the 40-product drop from burying the team's other conversation; anyone who doesn't want the volume can mute it.
- **What it changed:**
  - The review channel is configurable per install; one channel by default.
  - **One message per request, not per image.** All candidates for a product arrive in a single post with numbered actions, so the drop is ~40 messages, not ~160.
  - Discussion happens in that message's thread, keeping the channel scannable.
  - No DM approval path to build. One surface, one set of interactions.
  - **Cost:** Ellie's rejections are public. That matches how it works today, so it isn't new — but it argues against demanding a written reason on reject (see REQUIREMENTS Step 5).
  - Open: does **idea** review (#3, #9) share this channel or get its own? Same volume question, text instead of images.

### 3. Who writes shot ideas for the 40-product drop, and when?
- **Assumption:** **AI drafts, Ellie picks, and only then do images get made.** For any product without a shot idea, the system drafts 2–3 ideas from the product data (name, category, color, material, notes). The team approves, edits, or writes its own in Slack. No image is generated until an idea is approved.
- **Why:** Only 16 of 40 rows have ideas, and new exports will arrive mostly blank. Maya said explicitly: "don't burn our budget on stuff she'll reject." Rejecting a text idea costs essentially nothing; rejecting an image costs money. Picking from options on a phone is also far faster than writing from a blank cell.
- **What it changed:**
  - Adds an **idea-approval stage** before image generation: two decision points per product (idea, then images).
  - The idea step must be batch-friendly (e.g., many products reviewed in one pass), or it doubles Ellie's load on a 40-product drop.
  - Existing human-written ideas still get reviewed so vague ones can be clarified (see #9), but they start pre-filled.

#### 3a. The CSV/sheet is legacy record-keeping, not the system of record going forward
- **Assumption:** The spreadsheet is how this team tracked work *because they had nothing better*. The new tool takes over as much of that job as possible, and its **database becomes the source of truth** for products, ideas, candidates, approvals, and status.
- **Why:** The sheet can't hold approvals, candidates, or history, which is exactly why "nobody can tell you which of the sixteen requests are done." The brief says live sheet sync isn't expected.
- **What it changed:**
  - CSV becomes an **import format** (new products and drops come in this way; the brief requires it) and an **export format** (an updated CSV at the end), not something we keep in sync.
  - Re-imports must merge into existing records by SKU rather than overwrite state (see #12).
  - Idea capture, approvals, and status live in the app/Slack, not in sheet columns.

#### 3b. What should AI-drafted ideas be styled *against*?
- **Assumption:** Two layers of plain text the team owns:
  1. **House style** — a short editable blurb describing the brand's look ("warm, lived-in, natural light, no people, minimal props, a little mess"). Applies to every draft. **Seeded on install** from the 16 existing ideas plus product data and shown for the team to edit, rather than asked for cold.
  2. **Campaign theme** — an optional overlay applied to one batch of drafts ("holiday mantel, evergreen, candlelight" for Q4; "Halloween" in October). Switched on for a run, then off.
- **Why:** The 16 existing ideas share an obvious voice, so a style is derivable. But they are 4–6 word fragments ("gift-y", "styled on a sofa"), and few-shotting them would teach the model to write fragments exactly where #9 commits to detailed, structured scenes. They are also **6 of 16 holiday**, which is campaign bleed rather than house style — baking that into every draft puts evergreen on a patio shot in July. Splitting the two layers gives the team a lever they would otherwise only have by rejecting ideas one at a time, forty times.
- **What it changed:**
  - Two settings fields, both plain text, both editable from Slack.
  - Install shows a **seeded style blurb to confirm or edit**, never a blank box.
  - **Themed batches are a first-class action:** re-draft ideas for any set of products under a campaign theme — the Q4 campaign the brief names, Halloween, spring. A product can carry a seasonal shot and an everyday shot.
  - The campaign theme is recorded on the idea, so approved images know which campaign produced them.
  - **Tension with #5a:** done is product-level at 2+ approved images, so a themed round for an already-done product moves no progress number. Themed batches therefore need to be tracked as their own run. This is exactly the blind spot #5a flagged, arriving sooner than expected — **watch it.**
  - **Seasonal swap is manual.** Approval is what changes live images (#4), so a seasonal shot goes live on approval and the everyday shot returns when someone re-approves it. The image set per SKU stays flat — campaign is metadata on an image, not a container.
  - **Mitigation:** a campaign carries an **end date** whose only job is to post a reminder — "Halloween is over; 12 products are still on seasonal shots" — with the one-tap revert #4 already provides. That buys most of the safety of scheduled swapping for none of the machinery. Reminders are already a dependency per #5a.
  - **Next, not now:** campaign *sets* with date windows, where the per-SKU lookup serves whichever set is active and seasonal images expire on their own. Deferred for the scheduler, the more complex lookup, and a new failure mode (an expired set leaving a SKU short of images). Because every image records its campaign, this stays available later with no migration.
  - **Failure this prevents:** pumpkins on a product page in February — the "wrong image live for three weeks" incident from the brief, seasonally dressed.

### 4. Does "on the product page" have to be verified, or is "handed to the web person" enough?
> _To revisit during REQUIREMENTS review: the caching/immutable-URL, live-change notice + revert, image ordering, and deferred resizing details below were suggested defaults, not yet confirmed._
- **Assumption:** The system's job ends at **approved, SKU-named images that are ready for the site**. It does not push images into the storefront or verify the product page. Two things make "ready" real:
  1. Approved images are copied to the shared **Google Drive folder** with SKU-based filenames (for humans, social, and the Q4 campaign).
  2. The same images are served from **our own storage as a simple CDN**, with a per-SKU lookup the web developer can code against once. After that, the site pulls the current approved images by SKU automatically.
- **Why:** The brief never names the site platform and offers no site access (see 4a). The wrong-file incident came from ambiguous filenames and a folder full of non-final files. Since we already store every image, serving the approved ones by SKU removes the manual weekly upload and the "which files are final?" question entirely.
- **What it changed:**
  - Storage is the canonical home for images. Drive is a human-friendly copy of approved images only, never candidates.
  - **Per-SKU image lookup** (e.g., `GET /products/HG-002/images`) returns approved images in display order, with a primary image first.
  - **Every image version gets a unique, immutable URL.** Swapping an image changes the lookup, not the file behind a URL, so browser and CDN caches can't keep serving a replaced image.
  - **Approval = live** (once the site is wired up). Images can be replaced days or months later with no dev work. Because nobody sits in between anymore, every change to a product's live images posts a notice in Slack and can be **reverted in one tap**.
  - Status for Maya stops at "approved & ready." We can't confirm what's actually rendered on the product page.

#### 4a. The storefront platform is unknown
- **Assumption:** We don't know or integrate with their site platform. The web developer does a one-time integration against our per-SKU lookup.
- **Why:** The brief says only "their own site," and lists the toolkit as Google Docs/Sheets, Slack, and Gmail.
- **What it changed:** No Shopify/Squarespace/etc. connector in scope. Hosted platforms may prefer uploaded images over external URLs, so a platform connector is a "next" item once we know what they run. Image resizing and thumbnails are also deferred; we serve the full-size approved image.

### 5. What does Maya mean by "see where things stand": per product, per launch, or spend?
- **Assumption:** Maya wants **on-demand answers** at three zoom levels: overall, per launch or drop, and per product. Each answer covers progress by stage, spend, and what's stuck. She asks the bot instead of asking Ellie. The same report can optionally be **scheduled** (daily or weekly) for anyone who wants it pushed to them.
- **Why:** "Without having to ask Ellie" means self-serve. The rejected dashboard shows that anything requiring a separate login dies. A Slack command lives where the team already is. The optional schedule covers the "nobody remembers to check" risk without cluttering the channel by default.
- **What it changed:**
  - Slack command for status (e.g., `/shots status`, `/shots status <drop>`, `/shots <SKU>`). Output includes:
    - Counts per stage: ideas pending → generating → awaiting approval → approved & ready.
    - Spend for the selected scope.
    - Items stuck past a threshold.
  - Opt-in scheduled delivery of the same report (daily or weekly), sharing the report logic with the email digest from #2.
  - Requires: a **drop/batch** grouping for products (e.g., one per CSV import), **cost recorded per generation**, and a timestamp for each stage change to detect stuck items.

#### 5a. What counts as "done" for a product?
- **Assumption:** **The product (SKU) is the unit, and done = 2 or more approved images.** Status counts products, not requests: "32 of 40 done." Per #4, done means *approved & ready* — we don't verify the product page.
- **Why:** The brief's target is "2–3 approved images matching the shot idea," so two is the floor it names. Product-level is also the shape of the question people actually ask: Maya asks whether the drop is ready, and the web person asks what a given product page should show. Counting per request would be more precise but hands Maya two numbers to reconcile.
- **What it changed:**
  - One progress number per drop and per catalog, derived from each SKU's approved-image count.
  - Stage counts in status (#5) roll up to product state: ideas pending → generating → awaiting approval → approved & ready (done at 2+).
  - Approved images still record which idea produced them, for provenance and regeneration — they just aren't *counted* per idea.
  - **Cost:** a second idea for an already-done product moves no number. A Q4 campaign scene for a SKU that already has two everyday shots reads as no work outstanding. **Watch during the Q4 campaign:** if the team starts running deliberate second rounds per product, "done" probably has to become per-request after all.
  - **Short rounds wait for a person.** When a round ends with fewer than 2 approved, the SKU sits at "needs more" and the Slack message carries a one-tap **generate more**. Nothing regenerates on its own: #13 already made extra rounds deliberate, and four rejections usually means the *idea* was wrong, so an automatic rerun buys four more of the same.
  - **Consequence:** a SKU at 1-of-2 is blocked on nobody and appears in no queue. It surfaces only through the stuck-item list in status (#5) and through nudges, which promotes **reminders from a Part 3 extra to a dependency**. Rejection reasons feeding the next prompt (retry-with-feedback) is what makes round two better than round one rather than a rerun.

## Data (quirks in `data/catalog.csv`)

### 6. Are the gaps in SKU numbers (007, 015, 023, 031, 039) discontinued products, or just a sample artifact?
- **Assumption:** The gaps are an artifact of their existing record-keeping and mean nothing. A SKU is just a unique ID. Tracking discontinued products is out of scope.
- **Why:** The brief calls the export "a sample of the full 300," and the gaps are evenly spaced. HG-032 ("discontinued after spring?") is still in the sheet, which suggests products aren't removed from it when discontinued anyway.
- **What it changed:**
  - Import treats SKU as a unique key; consecutive numbering isn't checked.
  - **Nothing is deleted based on its absence from an import.** Products, ideas, and images stay in the database even if a later CSV leaves them out (see #12).
  - **Archive, not delete:** any SKU can be archived. Archived products are hidden from review queues, status reports, and idea drafting, but their data and history remain and they can be restored.

### 7. Are "El:" notes Ellie's own, and should they carry more weight (priority, cautions)?
- **Assumption:** "El:" probably marks Ellie's notes, but **no note gets special automatic treatment.** All notes are context: they inform AI idea and prompt drafting and are shown alongside items in review. **Priority is an explicit setting**, not something inferred from note text.
- **Why:** Notes mix priority ("do this one first"), direction ("needs to look premium"), caution ("smoke glass photographs badly"), and jokes ("plant not included lol"). Parsing them into workflow rules is fragile. Ellie reviews ideas before any money is spent (#3), so whichever drafted ideas she picks already reflect which notes matter. Her choice filters the notes.
- **What it changed:**
  - Notes are passed as context into idea drafting and displayed in Slack review messages.
  - No LLM classification of notes; no automatic priority from import.
  - **Manual priority flag:** Ellie can mark products as priority. Priority items sort to the top of every queue and list, and are called out by name in status reports and scheduled updates.
  - Open: can others set priority too (consistent with force-approve in #1), or only Ellie?

### 8. Should HG-032 ("discontinued after spring?") be skipped?
- **Assumption:** No. HG-032 is treated like every other product. Ideas are drafted for **every** product without a shot idea, and the idea review offers **Skip** (not now) and **Archive** (hide per #6).
- **Why:** The note is ambiguous in both directions. It could mean "shoot it before it's gone," "don't bother," or it may only have mattered when scheduling a photographer weeks out. When AI generation takes minutes, that timing concern may not apply at all. A person looking at the note in review is the right one to decide, not a rule.
- **What it changed:**
  - No special-case logic for notes suggesting discontinuation.
  - Idea review includes **Skip** and **Archive** actions alongside approve/edit.
  - Idea drafting runs for all blank products, not just requested ones. **Watch:** at full-catalog scale (~280 blank products), this is a large review pile for Ellie. Priority (#7), Skip, and batch-friendly review (#3) are what keep it manageable.

### 9. Vague or questioning ideas ("on a set dinner table, with food in it?", "gift-y"): interpret them, or send back to the person who wrote them?
- **Assumption:** Interpret them, and do it for **every** existing idea, not only the vague ones. Each existing idea is expanded into 2–3 concrete options:
  1. **Option 1** is the original idea rewritten into the same specific format as the others (scene, props, lighting), staying as close to what was written as possible. Any question in it is resolved into a concrete choice.
  2. **Options 2–3** are alternative takes that keep the spirit of the original.
  
  Ellie picks, edits, or writes her own. The raw original text is still shown for context.
- **Why:** We can't tell who wrote which idea, some are months old, and a question mark in a prompt is not something an image model can act on. Clear ideas benefit from a consistent, detailed rewrite too. Putting existing ideas through the same review as blank products (#3) means one flow for the team to learn and for us to build.
- **What it changed:**
  - One idea-drafting step with two modes: **expand** an existing idea (faithful rewrite + 2 variations) or **draft** from product data (3 ideas).
  - All options share one structured format, so they're comparable at a glance on a phone and map directly onto the generation prompt.
  - All 16 existing ideas go through idea review. That's more taps than auto-approving clear ones, a deliberate trade for consistency and for not spending on unreviewed prompts.

### 10. Multi-product ideas ("shoot with the mugs maybe", "bathroom set w/ the towels?"): is that a real request or a musing?
- **Assumption:** Treat these as real requests. A shot can feature **multiple SKUs**, and making that easy is a feature: Ellie or anyone on the team can group products into one generation.
- **Why:** For a home-goods brand, styled sets are the point: they cross-sell, and the Q4 campaign runs on scenes, not isolated items. The catalog has the matching products (HG-002 mug; HG-035/HG-038 towels). Luma image edit accepts up to 8 reference images for about $0.003 each, so the marginal cost is negligible.
- **What it changed:**
  - A shot idea has one **primary SKU** (whose white-background photo is the edit `source`) plus optional **featured SKUs** (passed as `image_ref`).
  - Grouping is available when reviewing or editing an idea (e.g., "add product" by SKU or name), and AI drafting may propose pairings from notes.
  - Images can relate to multiple products in the data model.
  - Approval must confirm **every** featured product looks right, not just the primary.
  - **Unverified:** how faithfully featured (reference) products are reproduced. Test with real generations before relying on it.
  - Open: does a multi-product image count toward each featured SKU's 2–3 approved images, and does it appear in each SKU's CDN lookup or only the primary's?

### 11. Notes about the source photo or past shoots ("photo slightly underexposed?", "came out too shiny in last shoot"): act on them?
- **Assumption:** No automatic action. These notes are context like any other (#7): "too shiny" informs idea drafting, and "underexposed?" is shown during review. The fix for a bad input is a simple **replace source photo** action per SKU.
- **Why:** A prompt can't reliably fix a bad source photo, because image edit preserves what it isn't told to change. Replacing the photo fixes the actual cause and covers problems no note mentions (bad crop, wrong color variant). Automatic photo analysis or touch-up risks shifting product color ("Sage" vs. "Forest") and would false-alarm on naturally dark products (Charcoal, Smoke).
- **What it changed:**
  - A **replace source photo** action per SKU in Slack, reusing the upload flow from the photographer path (#2).
  - Source photos are versioned. Future generations use the latest; originals are kept, and each candidate records which source version it came from.
  - A first round may come out dim for a bad source photo. We accept a few cents and one review as the cost of discovering it.
  - **Out of scope / future:** automatic source-photo review (exposure/quality checks) and AI touch-up before generation.

### 12. Will future exports really have the same columns? What if a row changes between exports (new idea, new photo URL)?
- **Assumption:** Exports will mostly keep the same columns but may carry quirks, and the team will keep editing the sheet out of habit for a while. Imports **bring in changes, but never overwrite existing product data without a person confirming.**
- **Why:** The database is the source of truth (#3a), but ignoring sheet edits would silently lose the team's work during the transition. Auto-overwriting has the opposite risk: a stale export could revert a fixed price or replaced photo. A quick side-by-side confirm sits between the two. Changes to a product that already has approved images may make those images wrong (new color, new photo), which is the "wrong image live for three weeks" failure again.
- **What it changed:**
  - **Validation (tolerant):**
    - Headers matched loosely (case/whitespace); `SKU` and `Photo` required; unknown columns ignored.
    - Rows with a missing SKU, duplicate SKU, or unreachable photo URL are rejected and listed in the import summary. The rest of the file still imports.
  - **New SKUs:** created directly.
  - **Existing SKUs, product detail changes** (name, category, color, material, price, notes): held as a **pending change** showing current vs. incoming, applied only when someone accepts.
  - **Existing SKUs, Photo URL changes:** same pending review, with old and new photos side by side. Accepting creates a new source photo version (#11).
  - **New or changed Shot Ideas:** skip the change-review step and go straight into normal idea review (#9). No images are generated until an idea is approved (#3).
  - **Blank cells never erase** existing data.
  - Approvals, candidates, priority, and archive state are never touched by an import.
  - **Re-review queue:** when an accepted change hits a SKU that already has approved images, those images enter a brief re-review ("still accurate?": keep / replace). Images stay live while they wait, so the site doesn't lose images mid-review.
  - Import summary in Slack, e.g., "12 new · 3 changes to review · 2 new ideas · 2 rows rejected."

## Budget and quality

### 13. What's the budget: per image, per month, per launch?
- **Assumption:** There's no fixed budget we know of, and at these prices the dollar amount isn't the real risk. Maya's concern is **runaway spend and surprises**. We control spend per product, make spend visible everywhere, and let the team set **warning thresholds** (not hard stops) against a budget they choose.
- **Why:** With Luma image edit at $0.0434 (`uni-1`) or $0.1030 (`uni-1-max`) per image and 4 candidates per product:
  - A 40-product drop costs about $7–16 per round.
  - The full 300-product catalog costs about $52–124 per round.
  
  Idea drafting costs a fraction of a cent. That's trivial next to a freelance shoot. The realistic way to waste money is regenerating one product over and over. A hard stop could block a launch over a few dollars, so warnings inform without blocking.
- **What it changed:**
  - **Per-product generation limits (settings):** candidates per round (default e.g. 4) and max rounds (default e.g. 3). Going beyond requires a deliberate "generate more."
  - **Cost recorded per generation**, attributed to product, drop/batch, and who triggered it.
  - **Budget warnings (settings):** optional weekly, monthly, and/or annual thresholds. Approaching or crossing one posts a Slack warning to the team. Nothing is paused.
  - **Spend reporting:** spend appears in status reports (#5) and per batch. A spend report compares this week against previous weeks and this month against previous months (and so on), available on demand and in scheduled reports.
  - No hard spending cap.

### 14. What counts as "matching the shot idea", and how faithful must the product be (exact color, exact shape)?
- **Assumption:** The product must be **faithful**: same shape, color, finish, and proportions as the source photo. Only the scene changes. **Ellie's (or a force-approver's) approval is the definition of "matches."** No automated quality screening.
- **Why:** Color and finish are how this brand differentiates products ("Sage" vs. "Forest", "Clay Pink" vs. "Terracotta"). A styled image that misrepresents the product causes returns and erodes trust. The person who knows the products best is the most reliable judge, and nothing automatic can wrongly hide a good image.
- **What it changed:**
  - Every generation prompt includes strict product-preservation instructions (keep the product exactly as in the source; change only the scene).
  - **Model selectable per product or idea:** default `uni-1`; switch to `uni-1-max` for premium or hard-to-photograph items (e.g., the cutting board, smoke glass). Model choice is reflected in cost tracking (#13).
  - No automated QC system. Ellie will see and reject bad candidates herself.
  - **Out of scope / future:** an automated accuracy check (vision model comparing candidate to source and idea before it reaches Slack). A natural trigger to revisit: spend reports (#13) or rejection rates show the team is paying for, and spending attention on, many inaccurate candidates.

#### 14a. (Temporary) Luma's image edit is highly accurate at preserving the product
- **Assumption:** Until tested, we assume `uni-1` image edit reproduces the source product accurately in most generations, so manual review alone is manageable.
- **Why:** Luma's docs say image edit "preserves the parts of the image you did not mention." We haven't run generations on this catalog yet.
- **What it changed:** Justifies deferring automated QC. **Revisit after test generations**, especially on hard cases (smoke glass HG-041, multi-color sets like HG-018/HG-020, and featured products passed as reference images per #10). If accuracy is poor, automated screening or a `uni-1-max` default moves back into scope.

### 15. Image format needs: aspect ratios for the product page vs. social, and resolution?
- **Assumption:** **Square 2048×2048 is the standard output**, matching the existing white-background product photos and what the product page almost certainly uses. Other aspect ratios are an **add-on for approved images**: anyone can request common ratios (e.g., 4:5, 9:16, 16:9), which are generated and then re-approved.
- **Why:** Luma image edit ignores `aspect_ratio`; output dimensions come from the source photo, and every source is 2048×2048. Product pages are the core use. Social and the Q4 campaign need other shapes, but only for shots the team already likes, so generating ratios after approval keeps spend tied to proven images.
- **What it changed:**
  - Core pipeline produces square images only; the CDN lookup (#4) serves square by default.
  - **Extra: aspect-ratio variants of approved images.** Requested per approved image, generated from the same approved idea (likely by padding the source photo to the target ratio), and sent through a quick re-approval. Stored and served alongside the square original.
  - A ratio variant is a new generation, not a crop, so it won't be pixel-identical to the approved square image. That's why it needs re-approval.
  - **Unverified:** whether padding the source produces good scenes in wide or tall frames. Test before committing.

### 16. Is it acceptable for customers to see AI-generated lifestyle images? Any disclosure needed?
- **Assumption:** Using AI images on product pages is acceptable. The team chose AI generation, the product itself must be accurate (#14), and only the scene is synthetic. **Whether and how to disclose it to shoppers is the team's decision, not ours.** Our job is to make sure the data exists so they can decide at any time.
- **Why:** Some ad platforms and jurisdictions have or are adding AI-content labeling rules, and those can change. Retrofitting provenance onto hundreds of images later means guessing. Recording it at creation is nearly free. (Not legal advice; Maya should confirm what applies to them.)
- **What it changed:**
  - **Every image records its origin:** `ai` or `photographer`, plus model and source photo version where applicable.
  - **Manual uploads (#2, #11) include an "AI-generated?" marker**, because an uploaded image may itself be AI-made (by a freelancer or another tool). Origin is never inferred from upload method.
  - **CDN lookup (#4) exposes `origin` per image**, so the web developer can show a label if and how the team chooses.
  - **Files carry AI-generation metadata:** AI-origin images are written with a standard embedded marker (e.g., IPTC digital source type / C2PA-style provenance) when stored. **Watch:** some social platforms read this and auto-label posts, which the team should know before the Q4 campaign.
