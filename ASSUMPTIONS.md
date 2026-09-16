# Assumptions

Questions I'd ask the team if I could, the assumption I proceeded on instead, and what that assumption changed about what I built.

> Status: **All 16 initial questions answered, plus four that writing the flows forced into the
> open** — #2b (how often a drop happens), #4b (the site knows what it lists and asks by theme),
> #4c (how many images a product page uses), and the sub-entries under #3b, #4, #5 and #14.
>
> Entries marked **[revised]** were changed by walking the flows in [USER_FLOWS.md](USER_FLOWS.md).
> **The original reasoning is kept in place**, with what changed and why recorded underneath —
> because the reason an assumption failed is worth more than the assumption, and an assumption
> quietly rewritten to match the outcome teaches nobody anything.

> **On build scope (added once the stack and the day were priced).** Nothing below has been
> withdrawn or softened. Several of these assumptions describe behaviour that is **designed and
> specified but not built in the ~1-day version**, and those entries now carry a **[v1 scope]**
> note saying so and pointing at *Part 5 — Build scope* in
> [REQUIREMENTS.md](REQUIREMENTS.md), where each deferral has a trigger. The distinction matters:
> an assumption that was wrong gets revised in place with its original reasoning kept; an
> assumption that was right but did not fit in a day gets a scope note and nothing else.

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
  - **[revised — USER_FLOWS Flow 3, Step 6] The friction is a required sentence.** A non-approver must say *why* they are deciding without an approver. A confirm dialog is friction someone in a hurry taps through without reading; typing cannot be done absent-mindedly. It is also the only friction that *produces* something — the audit trail promised below is only honest if it records why, not merely that. The reason is posted publicly with the approval (#2a) and shown wherever the forced approval appears, so an approver returning reads what was decided and why. `[Nudge an approver instead]` is offered alongside, since the honest answer is often "this could wait an hour." **Cost:** this is friction at 9pm before a launch, which is the scenario force-approve exists for — accepted deliberately. **Watch:** climbing forced-approval counts mean the approver set is too small, not that the friction is wrong.
  - Every approval records **who** approved and whether it was forced, so Ellie can see what was decided without her and the audit trail stays honest.
  - **[revised — USER_FLOWS Flow 4] The audit trail is recorded and exported, but has no browsable surface.** Nobody reads an audit trail until something has gone wrong, and the two questions asked in that moment are already answered where they happen: a forced approval shows its reason inline wherever it appears, and the live-image-change notice names who approved and offers the revert (#4). The full record exports as a separate event log — events and products are different shapes, and one file serves neither. A read-only **web data view** is recorded as future work; it is not the dashboard this team abandoned, because that one asked people to go somewhere to *do their work* and this is somewhere to *look something up when something is wrong*.
  - Comments are optional and are never a required step in the flow.
  - **The same rule applies at every decision point** — idea approval, image approval, **promoting an image to primary** (#4, Flow 7), and **setting the priority flag** (#7). One rule to learn instead of four, and Ellie stays the taste filter at the moment spend begins, which is exactly Maya's "don't burn our budget on stuff she'll reject." The test for whether something needs the rule: does it change what a customer sees, or what the team works on next?
  - **[revised — USER_FLOWS Flow 0]** "Ellie" is now a configurable **role**, not a name. Flow 0 makes the approver explicit so any team can install this:
    - Whoever invites the bot becomes the approver by default; they can hand the role to someone else during setup.
    - The role can be held by more than one person, added or removed later via `/shots approvers`.
    - Multiple approvers are an **or**, never an **and** — any one of them deciding is the decision. Nothing waits for a second signature, so "her pick is the decision" survives a team with two Ellies.
    - The set is **never empty** (with no approver, every approval is a force-approve and this distinction becomes decoration), only an approver can change it, and a workspace admin is the escape hatch if none is reachable.
    - Pending work waits on *an approver*, never on a person, so changing the role mid-drop moves nothing and loses nothing.
  - **Cost:** the 40-product drop needs ~40 idea approvals *and* up to 40 image approvals from the person who also runs half of everything else. That makes **batch idea review load-bearing, not a nice-to-have** (#3): a screen of drafted ideas has to clear in a handful of taps, not forty. This is the first place the design strains under the drop, and the first thing to watch after it ships.
  - **[v1 scope]** Setup names an approver and force-approve works as described. **`/shots approvers`
    and the channel-move proposal are deferred** — changing the approver set matters on week four,
    not in the first hour, and the escape hatch (a workspace admin) needs no code. See REQUIREMENTS
    Part 5.

### 2. Which tool does Ellie actually live in on her phone: Slack or Gmail?
- **Assumption:** **Slack is primary.** Email was only in the loop because the photographer was an outside party. With AI generation, the photographer is usually unnecessary, so email drops out of the approval path.
- **Why:** Opinions, 👍 requests, and the web person's "which files are final?" questions all happen in Slack. The approvals that got "buried" in email were buried there *because* of the photographer thread.
- **What it changed:**
  - Approval, discussion, and status all live in a Slack app. No email-based approval.
  - **Photographer escape hatch:** the Slack app accepts human-shot photos uploaded against a request. A freelancer can be added to the channel when one is used, and their shots go through the same approval flow as AI candidates.
  - **Email as a digest only (to be designed):** a daily email, or one at a frequency the user picks, summarizing pending decisions, built from the same data. It's a summary and nudge, not a place to act, so Slack stays the single place decisions happen.
  - **[revised — USER_FLOWS Flow 4] Deferred, and the reason is that Slack grew the feature email was for.** This line was written when the only way to learn anything was to go and look. Flow 4 changed that inside Slack: a drop posts its own progress daily, and nudges surface stuck items unasked. Email was going to be the thing that comes to you, and now something already does. **What it still uniquely covers:** the person who has stopped opening Slack — Ellie genuinely away, which is the scenario force-approve (#1) exists for. Every push this flow builds lands in a channel and reaches nobody who is not looking at it. **Signal to build it:** items being force-approved repeatedly, which means the channel is not reaching the person who should be deciding.
  - **[v1 scope]** The **photographer escape hatch is deferred** (Flow 5, REQUIREMENTS Part 5). It is
    an escape hatch from the AI path this product exists to replace, and it shares its gesture with
    Flow 6, so the two are cheaper built together than half-built separately. Nothing about the
    design changes; there is simply no upload button in v1. **Trigger:** a human shot actually
    needing to enter review.

#### 2a. Which Slack channel do candidate images land in?
- **Assumption:** A **dedicated review channel** (e.g. `#shot-reviews`), separate from the team's general channel. Candidates post there in the open, the team can weigh in before Ellie decides, and Ellie approves in-channel. Approvals and live-image changes (#4) post to the same channel.
- **Why:** This team's decisions are already public: ideas get 👍'd in Slack, opinions happen in threads, and Ellie forwards favorites for comment today. Keeping candidates visible preserves that, and it gives force-approvers (#1) somewhere to look when Ellie is away — a DM-to-Ellie design would hide the queue from everyone else. A *separate* channel is what stops ~160 candidate images during the 40-product drop from burying the team's other conversation; anyone who doesn't want the volume can mute it.
- **What it changed:**
  - The review channel is configurable per install; one channel by default.
  - **One message per request, not per image.** All candidates for a product arrive in a single post with numbered actions, so the drop is ~40 messages, not ~160.
  - Discussion happens in that message's thread, keeping the channel scannable.
  - No DM approval path to build. One surface, one set of interactions.
  - **Cost:** Ellie's rejections are public. That matches how it works today, so it isn't new — but it argues against demanding a written reason on reject (see REQUIREMENTS Step 5).
  - **[revised — USER_FLOWS Flow 0]** The channel is not configured, it is *invited*: whichever channel the bot is invited to becomes the review channel. A later invite elsewhere **proposes moving** reviews there, and only an approver can confirm the move — relocating the queue is the one action that can make an in-flight drop vanish from under the people watching it, so it gets the same gate as approving. Moves are announced in both channels and pending items come along.
  - ~~Open: does **idea** review (#3, #9) share this channel or get its own?~~ **[resolved — USER_FLOWS Flow 2, Step 0] They share one channel.** See #2b for the reasoning, which turns on how rarely drops happen.

#### 2b. How often does a CSV drop or new batch actually happen?
- **Question:** is this a steady flow of work, or a few bursts a year?
- **Assumption:** **A handful of times a year.** The load is peaky: busy for a few days during a drop, quiet for months between.
- **Why:** The brief says Ellie rebuilds the wishlist "two or three times a year," and describes the 40-product drop as an event rather than a routine. The 16 existing shot ideas are "some months old," which is the same cadence seen from the other side.
- **What it changed:**
  - **Idea review and candidate review share one channel** (resolves the open question in #2a). At a few drops a year, the channel reads as a chronological record of each one — CSV dropped → ideas on SKUs → candidates → approvals → quiet → repeat. Splitting ideas into their own channel would break that narrative in half to solve crowding that exists on a handful of days a year, and would give the team a second channel to mute wrongly.
  - The design targets **peak load, not steady load**: survive a burst of ~37 idea cards and ~150 candidate images over a few days, then go quiet. Nothing needs to be optimised for sustained throughput.
  - Decided idea cards **collapse in place** once approved, so the burst shrinks as it is worked rather than sitting above the candidates forever.
  - **This assumption is load-bearing for the single-channel decision.** If drops become frequent, or the catalog scales to 300 and rounds overlap, revisit it — a separate `#shot-ideas` channel is a configuration change, not a redesign. Recorded as a "next" item.
  - Related: it also means burst spend, not monthly run-rate, is the shape of the budget question (#13).

### 3. Who writes shot ideas for the 40-product drop, and when?
- **Assumption:** **AI drafts, Ellie picks, and only then do images get made.** For any product without a shot idea, the system drafts 2–3 ideas from the product data (name, category, color, material, notes). The team approves, edits, or writes its own in Slack. No image is generated until an idea is approved.
- **Why:** Only 16 of 40 rows have ideas, and new exports will arrive mostly blank. Maya said explicitly: "don't burn our budget on stuff she'll reject." Rejecting a text idea costs essentially nothing; rejecting an image costs money. Picking from options on a phone is also far faster than writing from a blank cell.
- **What it changed:**
  - Adds an **idea-approval stage** before image generation: two decision points per product (idea, then images).
  - The idea step must be batch-friendly (e.g., many products reviewed in one pass), or it doubles Ellie's load on a 40-product drop.
  - **[revised — USER_FLOWS Flow 2] "Batch-friendly" turned out not to mean "fewer cards."** The review is **one card per product, posted at once, with nothing pre-selected**. The volume is a *reading* cost that only the approver pays, one tap at a time; nobody else owes an opinion on every product, and the cards' real job is being individually addressable so the team can weigh in on the few they care about. The designs that collapse the scroll — a stepper, or approve-by-exception — also collapse the place where everyone else participates, and approve-by-exception is the one shape where a pure AI guess for a blank product can go live on inertia, which is exactly what this gate exists to prevent. What keeps it navigable instead: priority posts first (#7), and **a decided card collapses in place** to a one-line receipt, so the channel shrinks as the queue is worked.
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
  1. **House style** — a short editable blurb describing the brand's look ("warm, lived-in, natural light, no people, minimal props, a little mess"). Applies to every draft. ~~**Seeded on install** from the 16 existing ideas plus product data and shown for the team to edit, rather than asked for cold.~~ **[revised — see below.]**
  2. **Campaign theme** — an optional overlay applied to one batch of drafts ("holiday mantel, evergreen, candlelight" for Q4; "Halloween" in October). Switched on for a run, then off. **[revised — USER_FLOWS Flow 7, Step 4]** A theme is a **named thing, not a sentence**: a short stable **name** the site requests (`halloween`) plus the free-text **look** that steers drafting. Setting a campaign is *pick an existing theme or create one*, so October's images join the `halloween` set the site already asks for instead of spawning a second string beside it — picking is easier than typing, which is the only reliable way to keep a controlled vocabulary controlled. The look is editable; **the name is not**, because renaming would silently break a live page.
- **Why:** The 16 existing ideas share an obvious voice, so a style is derivable. But they are 4–6 word fragments ("gift-y", "styled on a sofa"), and few-shotting them would teach the model to write fragments exactly where #9 commits to detailed, structured scenes. They are also **6 of 16 holiday**, which is campaign bleed rather than house style — baking that into every draft puts evergreen on a patio shot in July. Splitting the two layers gives the team a lever they would otherwise only have by rejecting ideas one at a time, forty times.
- **What it changed:**
  - Two settings fields: the house style blurb (plain text), and the campaign theme — which is now a named theme with a look, not a plain-text field (see above).
  - ~~Install shows a **seeded style blurb to confirm or edit**, never a blank box.~~
  - **[revised — USER_FLOWS Flow 0, Step 3] Seeding at install was not possible.** The seed data is the 16 existing shot ideas, and those arrive by CSV — *after* install. Flow 0 ended with an empty database while Flow 1 listed a confirmed blurb as a precondition, so each flow expected the other to have done it. What replaced it:
    - **Setup asks the team to describe their look, in their own words** (skippable, so install never blocks; skipping means ideas draft from product data alone and the first import says so once). An example is shown as guidance, never as a prefilled value.
    - **The seeding idea survives as an opt-in action.** Once a catalog exists, `/shots style` offers "suggest one from your existing shot ideas." A team that skipped, or wrote something thin, can take the derived version whenever they want it.
    - **The original objection still stands and is worth remembering:** a box asked for cold is the wizard screen nobody fills in, and a blurb derived from real ideas beats one written from scratch. That argument did not turn out to be wrong — it just could not be satisfied at install, so it moved from being a dependency to being an offer.
  - **Themed batches are a first-class action:** re-draft ideas for any set of products under a campaign theme — the Q4 campaign the brief names, Halloween, spring. A product can carry a seasonal shot and an everyday shot.
  - The campaign theme is recorded on the idea, so approved images know which campaign produced them.
  - **Tension with #5a:** done is product-level at 2+ approved images, so a themed round for an already-done product moves no progress number. Themed batches therefore need to be tracked as their own run. This is exactly the blind spot #5a flagged, arriving sooner than expected — **watch it.**
  - ~~**Seasonal swap is manual.**~~ **[revised — see #4b]** Campaign is still metadata on an image rather than a container, but the image set per SKU is **no longer flat**: it is grouped by theme at request time. Approving a holiday shot adds to that SKU's holiday set; it does not displace the everyday images, and nobody has to re-approve anything to switch back. The swap is not manual and not scheduled — **it is the caller's question.**
  - **Mitigation:** a campaign carries an **end date** whose only job is to post a reminder — "Halloween is over; 12 products are still on seasonal shots" — with the one-tap revert #4 already provides. That buys most of the safety of scheduled swapping for none of the machinery. Reminders are already a dependency per #5a.
  - ~~**Next, not now:** campaign *sets* with date windows, where the per-SKU lookup serves whichever set is active and seasonal images expire on their own.~~ **[revised — see #4b and USER_FLOWS Flow 7]** Mostly unnecessary, because the **caller asks for the theme**. The site owns the calendar, so there is no scheduler, no active-set state, nothing to expire, and no SKU left short — an unthemed SKU falls back to its defaults. What stays deferred is only the part that was really about scheduling: *us* deciding when a season starts, which we now never do.
  - **Failure this prevents:** pumpkins on a product page in February — the "wrong image live for three weeks" incident from the brief, seasonally dressed. **[revised]** Now prevented structurally rather than by reminder: in February the site stops asking for holiday images, and the defaults come back on their own.

### 4. Does "on the product page" have to be verified, or is "handed to the web person" enough?
> _To revisit during REQUIREMENTS review: the caching/immutable-URL, live-change notice + revert, image ordering, and deferred resizing details below were suggested defaults, not yet confirmed._
- **Assumption:** The system's job ends at **approved, SKU-named images that are ready for the site**. It does not push images into the storefront or verify the product page. Two things make "ready" real:
  1. ~~Approved images are copied to the shared **Google Drive folder** with SKU-based filenames (for humans, social, and the Q4 campaign).~~ **[revised — Drive is cut; see below.]**
  2. The images are served from **our own storage as a simple CDN**, with a per-SKU lookup the web developer can code against once. After that, the site pulls the current approved images by SKU automatically.
- **Why:** The brief never names the site platform and offers no site access (see 4a). The wrong-file incident came from ambiguous filenames and a folder full of non-final files. Since we already store every image, serving the approved ones by SKU removes the manual weekly upload and the "which files are final?" question entirely.
- **What it changed:**
  - Storage is the canonical home for images. ~~Drive is a human-friendly copy of approved images only, never candidates.~~
  - **[revised — USER_FLOWS Flow 0, Step 5] Google Drive is cut from scope entirely.** Storage was always canonical, so the Drive copy was pure addition: it cost a Google service account, an OAuth path, folder configuration, and a class of failure where the copy and the canonical store disagree — which is the wrong-file incident wearing a different hat. It bought nothing the storage layer did not already do.
    - **The lookup base URL is posted in the channel at setup**, so the web person never has to ask anyone for it. That was the actual pain in the brief ("has to ask in Slack which files are final"), and with Drive gone the lookup is the only path to approved images.
    - **What the team loses, and what covers it:** a browsable folder for social and the Q4 campaign — the Slack approval message still holds the image and the review channel is a searchable archive; grabbing many at once — the updated CSV export with image-link columns, which this promotes from nice-to-have to load-bearing.
    - **Next, not now:** `/shots images HG-002`, or for a whole drop — asking the bot for approved files. That is Drive's real job (a human-facing way to fetch approved images without a folder, a login, or a developer) without Drive. It needs no new data: every image already has a stable URL and an origin (#16).
  - **Per-SKU image lookup** (e.g., `GET /products/HG-002/images`) returns approved images in display order, with a primary image first.
  - **Every image version gets a unique, immutable URL.** Swapping an image changes the lookup, not the file behind a URL, so browser and CDN caches can't keep serving a replaced image.
  - **Approval = live** (once the site is wired up). Images can be replaced days or months later with no dev work. Because nobody sits in between anymore, every change to a product's live images posts a notice in Slack and can be **reverted in one tap**.
  - Status for Maya stops at "approved & ready." We can't confirm what's actually rendered on the product page.

#### 4a. The storefront platform is unknown
- **Assumption:** We don't know or integrate with their site platform. The web developer does a one-time integration against our per-SKU lookup.
- **Why:** The brief says only "their own site," and lists the toolkit as Google Docs/Sheets, Slack, and Gmail.
- **What it changed:** No Shopify/Squarespace/etc. connector in scope. Hosted platforms may prefer uploaded images over external URLs, so a platform connector is a "next" item once we know what they run. Image resizing and thumbnails are also deferred; we serve the full-size approved image.

#### 4b. The site already knows which SKUs it lists, and asks for images by SKU **and theme**
- **Question:** does our lookup have to tell the site what to show, or does the site already know?
- **Assumption:** The web developer's system **already determines programmatically which SKUs appear on the site**. Our lookup is only ever asked about a product the site already intends to display. It also accepts an optional **theme**: the front end asks for "HG-002, holiday" and gets the holiday images, or **the defaults if that SKU has no holiday version**.
- **Why:** They have a real storefront with a product catalogue driving it; deciding what is listed is the thing a storefront already does, and nothing in the brief suggests otherwise. Given that, the calendar is also the site's to keep — it knows when its holiday campaign starts far better than we do.
- **What it changed:**
  - **The lookup is a question-answering service, not a source of truth about the catalogue.** No "list all SKUs" endpoint is needed for the site to work, and a SKU we know nothing about is simply a question with an empty answer.
  - **Themes are a request parameter with a fallback**, which is a much smaller thing than what #3b deferred. See below.
  - **Archiving stops being a publishing switch.** Archived products keep being served (resolving the open question in #6): archive is *our* workflow state — hidden from queues, status and drafting — and the site independently decides what it lists. A product hidden from Ellie's queue but still on the site must not lose its images.
  - **Robustness matters more than correctness at the edge.** Because approval reaches the site with nobody in between (#4), the lookup is on the page-render path: a well-formed request never fails, and "no images" is a valid answer the site can fall back from.

- **This largely resolves what #3b deferred, by moving the decision to the caller.** #3b put "campaign sets with date windows" in *next, not now*, because it needed a scheduler, a set-aware lookup, and it introduced a failure mode where an expired set leaves a SKU short of images. **The front end asking for a theme removes all three:**
  - No scheduler — the site owns the calendar and simply stops asking for `holiday`.
  - No expiry and no active-set state on our side — there is nothing to expire.
  - No "SKU left short" — the fallback to defaults *is* the answer to a missing themed set.
  - It also dissolves #3b's named failure, pumpkins on a product page in February: February simply stops asking for holiday images. The end-date reminder and one-tap revert stay useful, but they are no longer the only thing standing between the team and a stale seasonal image.
  - What remains deferred from #3b is only the part that was genuinely about scheduling: **us** deciding when a season starts. We never do. That is the caller's job now.

#### 4c. How many images does a product page actually use?
- **Question:** what is a "full" gallery on their site — one hero image, three, eight?
- **Assumption:** **About three.** We do not know, and the site is not ours to inspect (#4a), so this is a working number, not a fact.
- **Why:** The brief's own target is "2–3 approved images matching the shot idea", which is the only number anyone has written down. Three is also unremarkable for a home-goods product page: a hero plus two supporting shots.
- **What it changed:**
  - **A themed request returns themed images first, then defaults** (USER_FLOWS Flow 7, Step 3). With a three-image gallery, one holiday shot plus two everyday shots fills the page and leads with the season — which is the common case, since a campaign round usually produces one good seasonal scene per product, not three.
  - **Approved-image counts are tracked per SKU, split by theme, and reported** (#5, Flow 4). That is what makes "this product would show a thin gallery" visible, and generating one more is then a decision someone can actually make.
  - **Tension with #5a, recorded rather than resolved:** done is **2+** approved images, but the page wants about **3**. A product can be *done* and still render one image short. These are deliberately kept as two different signals — done is the brief's own floor and the thing Maya counts, while "thin" is a quality nudge that never blocks a launch. **Watch:** if most products sit at exactly 2, the target and the definition of done have drifted apart and one of them should move.
  - **If the real number turns out to be one**, themed-first-then-defaults quietly becomes a strict swap, and nothing breaks. **If it is eight**, the whole catalogue is thin and the candidates-per-round setting (#13) is the lever.

### 5. What does Maya mean by "see where things stand": per product, per launch, or spend?
- **Assumption:** Maya wants **on-demand answers** at three zoom levels: overall, per launch or drop, and per product. Each answer covers progress by stage, spend, and what's stuck. She asks the bot instead of asking Ellie. The same report can optionally be **scheduled** (daily or weekly) for anyone who wants it pushed to them.
- **Why:** "Without having to ask Ellie" means self-serve. The rejected dashboard shows that anything requiring a separate login dies. A Slack command lives where the team already is. The optional schedule covers the "nobody remembers to check" risk without cluttering the channel by default.
- **What it changed:**
  - Slack command for status (e.g., `/shots status`, `/shots status <drop>`, `/shots <SKU>`). Output includes:
    - Counts per stage: ideas pending → generating → awaiting approval → approved & ready.
    - Spend for the selected scope.
    - Items stuck past a threshold.
  - ~~Opt-in scheduled delivery of the same report (daily or weekly)~~ **[revised — USER_FLOWS Flow 4, Step 8]** A drop **reports itself**: the import summary is the start, a daily post while the drop is open, and a completion post when it finishes. On by default during a drop, and **nothing at all between drops**. Maya's requirement was never a report, it was *not having to ask* — and a command she has to remember to run is the same shape as the dashboard she has to remember to open, which already failed once. This does not become noise because drops happen a handful of times a year (#2b), so the automatic reporting is bounded by the drop's own lifetime. A drop also goes quiet if nothing changes for several days, at which point a repeated total is noise and the nudge (which names specific stuck items) is the right mechanism. `/shots status` remains available to anyone at any time. **Next:** making the frequency configurable — a sensible default is less to build and more likely to reach her than an opt-in she must find.
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
  - **[resolved — #4b, USER_FLOWS Flow 7] Archived products keep being served.** Archive is *our* workflow state, not a publishing switch: the site decides independently what it lists (#4b), so a product hidden from Ellie's queue but still on the site must not lose its images. Archiving never breaks a live page.
  - **[revised — USER_FLOWS Flow 1, Step 4] Archive means "not right now," not "dead."** A team may archive a product that is only seasonally available, then want it back to shoot under a new theme. So **a SKU appearing in an import is unarchived**, named in the import summary (not just counted) with a one-tap undo, and returns with its full history. The undo sits in the same message as the campaign question, which is what makes it safe: drafting has not started, so a stale export that resurrects thirty products costs one tap to reverse and nothing to spend.
    - **Watch:** an unarchived seasonal product may already have 2+ approved images, so it reads as **done** (#5a) even though it was re-imported precisely because it needs new themed shots. It appears in no "needs work" count. That is why the summary names these products rather than folding them into a number — and it is #3b's tension with #5a firing again.
  - **[v1 scope]** The **archive and unarchive actions are deferred** (REQUIREMENTS Part 5). Idea
    review's **Skip** covers "not right now" for a 40-product drop; archive earns its place at 300
    SKUs, when the queue starts carrying products nobody intends to shoot. The data model keeps the
    archived flag, so turning the actions on later adds no migration.

### 7. Are "El:" notes Ellie's own, and should they carry more weight (priority, cautions)?
- **Assumption:** "El:" probably marks Ellie's notes, but **no note gets special automatic treatment.** All notes are context: they inform AI idea and prompt drafting and are shown alongside items in review. **Priority is an explicit setting**, not something inferred from note text.
- **Why:** Notes mix priority ("do this one first"), direction ("needs to look premium"), caution ("smoke glass photographs badly"), and jokes ("plant not included lol"). Parsing them into workflow rules is fragile. Ellie reviews ideas before any money is spent (#3), so whichever drafted ideas she picks already reflect which notes matter. Her choice filters the notes.
- **What it changed:**
  - Notes are passed as context into idea drafting and displayed in Slack review messages.
  - No LLM classification of notes; no automatic priority from import.
  - **Manual priority flag:** products can be marked priority (see the resolved note below for who). Priority items sort to the top of every queue and list, and are called out **by name** in status reports and the drop's own daily post — "2 priority items are waiting" is not actionable, and "HG-002 is waiting" is.
  - ~~Open: can others set priority too, or only Ellie?~~ **[resolved] Priority follows the approval rule, exactly.** An approver sets or clears it in one tap; anyone else can, with the same force-approve friction — a required sentence saying why, recorded and posted publicly (#1, USER_FLOWS Flow 3 Step 6). **One rule, everywhere a decision is made:** approving an idea, approving an image, promoting an image to primary, and setting priority all behave identically. That is one thing to learn instead of four, and it means no decision in the system can be made anonymously or without friction by someone who is not the approver.

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
  - ~~Open: does a multi-product image count toward each featured SKU's 2–3 approved images?~~ **[resolved — USER_FLOWS Flow 3, Step 8] The primary SKU only.** Featured SKUs get the image as a **related** image: attached and findable, but not counted toward their 2 and never primary in their lookup. The rule is that **a product is only ever counted on images it was the source for**, because the primary's photo is the edit `source` and is what the model actually preserves (#14), while `image_ref` fidelity is unverified — and now untested by choice (#14a). Counting otherwise would let a SKU reach **done** (#5a) on a shot where its own colour or shape is subtly wrong, with nothing downstream to catch it. **Consequence:** grouping helps the site more than the queue, which is the honest trade — #10's case for grouping was always about how styled sets get used. **Revisit** if `image_ref` fidelity proves good: counting for every SKU becomes a setting, not a redesign, since the data model already relates an image to several products.
- **[v1 scope]** **Grouping is deferred** (REQUIREMENTS Part 5). This entry's own conclusion is why:
  featured SKUs are not counted toward done, so grouping "helps the site more than the queue." The
  image-to-products relation ships in the schema, so the deferral is a missing button rather than a
  missing model. **Trigger:** someone asking for a styled set, or `image_ref` fidelity testing landing.

### 11. Notes about the source photo or past shoots ("photo slightly underexposed?", "came out too shiny in last shoot"): act on them?
- **Assumption:** No automatic action. These notes are context like any other (#7): "too shiny" informs idea drafting, and "underexposed?" is shown during review. The fix for a bad input is a simple **replace source photo** action per SKU.
- **Why:** A prompt can't reliably fix a bad source photo, because image edit preserves what it isn't told to change. Replacing the photo fixes the actual cause and covers problems no note mentions (bad crop, wrong color variant). Automatic photo analysis or touch-up risks shifting product color ("Sage" vs. "Forest") and would false-alarm on naturally dark products (Charcoal, Smoke).
- **What it changed:**
  - A **replace source photo** action per SKU in Slack, reusing the upload flow from the photographer path (#2).
    - **[revised — USER_FLOWS Flows 5 and 6]** The upload is a **drop in the channel**, and the bot asks which kind of photo it is — a finished shot for review, or a new source photo. The two options are described by *what they do next* rather than by name, because picking wrong here is both expensive and silent. **Replacing the source generates a new round immediately** (the cost is on the button), since the reason to replace is almost always that the last round was wrong because the input was wrong. **A new source resets the round counter** (#13): max rounds exists to stop repeated regeneration of the same thing, and a different source photo is not the same thing. If the product has no approved idea, nothing generates — #3 is absolute.
  - Source photos are versioned. Future generations use the latest; originals are kept, and each candidate records which source version it came from — including its **dimensions**, which matters because output size comes from the source (#15). A non-square upload is accepted with a plain warning about the effect rather than refused or silently padded: refusing the only photo someone has makes a tool people work around, and altering a product photo without saying so is the invisible change this design exists to prevent. Robust image intake is recorded as future work.
  - A first round may come out dim for a bad source photo. We accept a few cents and one review as the cost of discovering it.
  - **Out of scope / future:** automatic source-photo review (exposure/quality checks) and AI touch-up before generation.
  - **[v1 scope]** **Replace source photo is deferred** (Flow 6, REQUIREMENTS Part 5) — and this is the
    deferral with the most visible edge, so it is worth stating plainly. v1 *does* ship the
    **needs a source photo** flag from #12, which means the system can tell you a product is blocked
    on a bad or missing photo and cannot yet offer you the button that fixes it. That is an honest
    gap rather than a hidden one, and it is first in line if the day goes better than priced.

### 12. Will future exports really have the same columns? What if a row changes between exports (new idea, new photo URL)?
- **Assumption:** Exports will mostly keep the same columns but may carry quirks, and the team will keep editing the sheet out of habit for a while. Imports **bring in changes, but never overwrite existing product data without a person confirming.**
- **Why:** The database is the source of truth (#3a), but ignoring sheet edits would silently lose the team's work during the transition. Auto-overwriting has the opposite risk: a stale export could revert a fixed price or replaced photo. A quick side-by-side confirm sits between the two. Changes to a product that already has approved images may make those images wrong (new color, new photo), which is the "wrong image live for three weeks" failure again.
- **What it changed:**
  - **Validation (tolerant):**
    - Headers matched loosely (case/whitespace); `SKU` and `Photo` required; unknown columns ignored.
    - ~~Rows with a missing SKU, duplicate SKU, or unreachable photo URL are rejected and listed in the import summary.~~ The rest of the file still imports. **[revised below.]**
    - **[revised — USER_FLOWS Flow 1, Steps 2–5] Rejection is reserved for broken identity.** Only a **missing or duplicate SKU** is rejected: there is nothing to key the record on, so there is nothing to keep. An **unreachable photo URL is no longer a rejection** — the row still applies, and:
      - if the SKU has no photo in the database, the product is created and flagged **needs a source photo**. Ideas still draft (they are text and need no photo); generation is blocked until a photo is uploaded (#11), and the warning travels with the product into idea review.
      - if the SKU already has a photo, nothing is flagged: the existing source photo version stands, consistent with "blanks never erase."
      - **Why:** a rejected row is invisible the moment the Slack message scrolls, which is the one thing this flow exists to prevent. A flagged product sits in the queue, in status, and in nudges — machinery #5a already made a dependency. It also means a flaky asset host turns a clean import into a visible to-do list rather than a partial one, and the fix is already built (**replace source photo**, #11), so a phone-only person can unblock it without any per-row import UI.
  - **New SKUs:** created directly.
  - **Existing SKUs, product detail changes** (name, category, color, material, price, notes): held as a **pending change** showing current vs. incoming, applied only when someone accepts.
  - **Existing SKUs, Photo URL changes:** same pending review, with old and new photos side by side. Accepting creates a new source photo version (#11).
  - **New or changed Shot Ideas:** skip the change-review step and go straight into normal idea review (#9). No images are generated until an idea is approved (#3).
  - **Blank cells never erase** existing data.
  - Approvals, candidates, priority, and archive state are never touched by an import.
  - **Re-review queue:** when an accepted change hits a SKU that already has approved images, those images enter a brief re-review ("still accurate?": keep / replace). Images stay live while they wait, so the site doesn't lose images mid-review.
    - **[revised — USER_FLOWS Flow 6, Step 4]** This is now the *same question* asked when someone replaces a source photo manually, rather than a separate re-review of its own: **keep them**, or **start over** (back to ideation and generation for that SKU). Same photo change, same consequence, one interaction to learn — the re-review was the right idea described before there was a flow to put it in. The question is phrased as the action rather than as "did the product change?", because that asks someone to make a judgement and then map it to a consequence they cannot see. On **start over**, the old images stay live and are flagged in status as "from the previous photo"; once the SKU has 2+ newly approved images, a one-tap **retire the older images** appears, which is itself a live change and carries the usual notice and revert (#4). Nothing is deleted.
  - **[revised — USER_FLOWS Flow 1, Step 6] Pending changes bulk-accept, except photos.** Detail changes (price, name, category, colour, material, notes) can be accepted together: wrong is wrong, but it is text in a database and nothing goes live. **Photo changes are always individual**, because a new photo creates a source version and can send approved images to re-review — the exact path to "the wrong image was live for three weeks." The two are counted and presented separately so a bulk accept can never quietly include a photo, and a SKU changing both splits across the two groups. Every accept is attributed, bulk or not. Rationale for having a bulk path at all: a thirty-card list is what makes people tap through without reading, which costs the review its entire purpose.
  - **[revised — USER_FLOWS Flow 1, Steps 3–5] Re-import is the repair path, and it is safe.** Unchanged rows are no-ops and SKUs match by key, so **re-dropping the same file is idempotent**. That matters because "fix the bad rows in the sheet and export again" is what a person actually does, and it keeps the sheet authoritative through the transition (#3a) with no per-row editing UI in Slack — which would write the correction to the database but not the sheet, so the next export would re-break the same row.
  - Import summary in Slack, e.g., "12 new · 3 changes to review · 2 new ideas · 2 rows rejected."
  - **[v1 scope]** **Change-review is deferred** (REQUIREMENTS Part 5): v1 creates new SKUs, applies
    new shot ideas, and leaves existing rows alone. Next month's drop is *new* products, which the
    spine handles; and the photo-change half of this entry depends on source-photo versioning from
    Flow 6, which is also deferred — so building half of it would mean building the half that cannot
    stand alone. **What this obliges v1 to do:** the import summary must say out loud that changes to
    existing products were not applied. A silent no-op here is precisely the "nobody can tell you
    which requests are done" failure in a new costume.

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
  - **[v1 scope]** **Warning thresholds and week-over-week / month-over-month comparisons are
    deferred** (REQUIREMENTS Part 5). Spend itself is not: cost is recorded per generation and shown
    per product, per drop and overall in `/shots status`. Thresholds add *alerting* to a number
    already in front of everyone, and at a handful of drops a year (#2b) a calendar comparison has
    less signal than the per-drop breakdown v1 ships. **Trigger:** a second drop completing, so there
    is something to compare against — or spend surprising someone, which the visible figures would
    show first.

### 14. What counts as "matching the shot idea", and how faithful must the product be (exact color, exact shape)?
- **Assumption:** The product must be **faithful**: same shape, color, finish, and proportions as the source photo. Only the scene changes. **Ellie's (or a force-approver's) approval is the definition of "matches."** No automated quality screening.
- **Why:** Color and finish are how this brand differentiates products ("Sage" vs. "Forest", "Clay Pink" vs. "Terracotta"). A styled image that misrepresents the product causes returns and erodes trust. The person who knows the products best is the most reliable judge, and nothing automatic can wrongly hide a good image.
- **What it changed:**
  - Every generation prompt includes strict product-preservation instructions (keep the product exactly as in the source; change only the scene).
  - **Model selectable per product or idea:** default `uni-1`; switch to `uni-1-max` for premium or hard-to-photograph items (e.g., the cutting board, smoke glass). Model choice is reflected in cost tracking (#13).
  - No automated QC system. Ellie will see and reject bad candidates herself.
  - **Out of scope / future:** an automated accuracy check (vision model comparing candidate to source and idea before it reaches Slack). A natural trigger to revisit: spend reports (#13) or rejection rates show the team is paying for, and spending attention on, many inaccurate candidates.

##### 14a. Luma's image edit is highly accurate at preserving the product
- **Assumption:** `uni-1` image edit reproduces the source product accurately in most generations, so manual review alone is manageable. **We proceed on this rather than testing it first** — it was labelled temporary when written, and is now a deliberate standing assumption with a trigger for revisiting.
- **Why:** Luma's docs say image edit "preserves the parts of the image you did not mention." We haven't run generations on this catalog yet.
- **What it changed:** Justifies deferring automated QC. ~~**Revisit after test generations**~~
- **[revised]** We proceed on this assumption rather than testing it first: **systematic image-quality testing is a next/future item, not a gate on the design.** The reasoning is that rejection rates in real use are a cheaper and more honest signal than a test pass judged against our own guesses about what "good" means — and the design already routes every candidate past a person who knows these products (#14), so a bad generation cannot reach a customer either way. **Revisit** if approvals-per-round run low, or before relying on featured-product fidelity (#10), which is the one place this assumption is doing work no human check covers cheaply. If accuracy turns out to be poor, automated screening or a `uni-1-max` default moves back into scope.

### 15. Image format needs: aspect ratios for the product page vs. social, and resolution?
- **Assumption:** **Square 2048×2048 is the standard output**, matching the existing white-background product photos and what the product page almost certainly uses. Other aspect ratios are an **add-on for approved images**: anyone can request common ratios (e.g., 4:5, 9:16, 16:9), which are generated and then re-approved.
- **Why:** Luma image edit ignores `aspect_ratio`; output dimensions come from the source photo, and every source is 2048×2048. Product pages are the core use. Social and the Q4 campaign need other shapes, but only for shots the team already likes, so generating ratios after approval keeps spend tied to proven images.
- **What it changed:**
  - Core pipeline produces square images only; the CDN lookup (#4) serves square by default.
  - ~~**Extra: aspect-ratio variants of approved images.**~~ **[revised] Deferred to Part 4 — square only.** The design stands: a variant would be requested per approved image, generated from the same approved idea (likely by padding the source to the target ratio), re-approved because it is a new generation rather than a crop, and served alongside the square original. It is out of scope because **no flow depends on it** — square matches every source photo and is what a product page wants, and variants only ever apply to images already approved. The padded-source approach is also **unverified, and now untested by choice** (#14a), so building on it would mean building on a guess. **Trigger to build it:** someone asking for a crop of an approved image for social or ads — concretely, a request that today ends with a person cropping a file by hand.

### 16. Is it acceptable for customers to see AI-generated lifestyle images? Any disclosure needed?
- **Assumption:** Using AI images on product pages is acceptable. The team chose AI generation, the product itself must be accurate (#14), and only the scene is synthetic. **Whether and how to disclose it to shoppers is the team's decision, not ours.** Our job is to make sure the data exists so they can decide at any time.
- **Why:** Some ad platforms and jurisdictions have or are adding AI-content labeling rules, and those can change. Retrofitting provenance onto hundreds of images later means guessing. Recording it at creation is nearly free. (Not legal advice; Maya should confirm what applies to them.)
- **What it changed:**
  - **Every image records its origin:** `ai` or `photographer`, plus model and source photo version where applicable.
  - **Manual uploads (#2, #11) include an "AI-generated?" marker**, because an uploaded image may itself be AI-made (by a freelancer or another tool). Origin is never inferred from upload method.
  - **CDN lookup (#4) exposes `origin` per image**, so the web developer can show a label if and how the team chooses.
  - **Files carry AI-generation metadata:** AI-origin images are written with a standard embedded marker (e.g., IPTC digital source type / C2PA-style provenance) when stored. **Watch:** some social platforms read this and auto-label posts, which the team should know before the Q4 campaign.
