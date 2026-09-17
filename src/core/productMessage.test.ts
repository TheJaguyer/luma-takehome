import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { roundMessageBlocks, type RoundView } from "./productMessage.js";
import { aiProvenanceXmp } from "./provenance.js";

const candidates = (states: string[], approved: number[] = []) =>
  states.map((state, i) => ({ id: `c${i + 1}`, position: i + 1, state, error: state === "FAILED" ? "generation_failed" : null, costUsd: state === "FAILED" ? 0 : 0.0434, approvedBy: approved.includes(i + 1) ? "U1" : null }));

const view = (over: Partial<RoundView> & { state?: RoundView["round"]["state"] } = {}): RoundView => ({
  round: { id: "r1", number: 1, state: over.state ?? "AWAITING_DECISION", model: "uni-1", feedback: null, sheetFileId: "F1" },
  maxRounds: 3,
  product: { sku: "HG-002", name: "Stoneware Mug 12oz", color: "Sage" },
  theme: null,
  idea: { headline: "Morning counter", decidedBy: null, forced: false, forceReason: null, state: "APPROVED" },
  candidates: candidates(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]),
  live: 0,
  ...over,
});
const text = (v: RoundView) => JSON.stringify(roundMessageBlocks(v));
const actionIds = (v: RoundView) =>
  roundMessageBlocks(v).flatMap((b) => (b.type === "actions" ? b.elements.map((e) => ("action_id" in e ? e.action_id : "")) : []));

test("generating shows the round and cost, with nothing to press", () => {
  const t = text(view({ state: "GENERATING" }));
  assert.match(t, /generating 4 candidates · \$0\.17/);
  // Rounds 1 and 2 are the normal path: no counter.
  assert.doesNotMatch(t, /round \d/);
  assert.deepEqual(actionIds(view({ state: "GENERATING" })), []);
});

test("awaiting a decision: the sheet, a number per candidate, and progress once something is approved", () => {
  assert.deepEqual(actionIds(view()), ["candidate_open_1", "candidate_open_2", "candidate_open_3", "candidate_open_4", "round_reject"]);
  const one = view({ candidates: candidates(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"], [2]), live: 1 });
  assert.match(text(one), /✅ 1 approved · needs 1 more/);
  assert.match(text(one), /✅ 2/);
  assert.match(text(one), /None of the rest/);
});

test("a short round offers retry for the missing ones only", () => {
  const short = view({ candidates: candidates(["SUCCEEDED", "FAILED", "SUCCEEDED", "FAILED"]) });
  assert.deepEqual(actionIds(short), ["candidate_open_1", "candidate_open_3", "round_reject", "round_retry_missing"]);
  assert.match(text(short), /Retry 2 missing/);
});

test("done collapses to one line, and the only thing left to do is another idea", () => {
  const done = view({ candidates: candidates(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"], [1, 3]), live: 2 });
  const blocks = roundMessageBlocks(done);
  assert.equal(blocks.length, 1);
  assert.match(text(done), /done — 2 approved images, live now/);
  assert.deepEqual(actionIds(done), []);
  assert.match(text(done), /"action_id":"round_new_idea".+Generate another/);
});

test("a decider is named only when it is not the approver, and never as a mention", () => {
  // deciderLabel (src/core/people.ts) returns null for the approver, a plain name for anyone else.
  assert.doesNotMatch(text(view({ idea: { ...view().idea, decidedBy: null } })), /approved by/);
  const other = text(view({ idea: { ...view().idea, decidedBy: "Sam" } }));
  assert.match(other, /approved by Sam/);
  assert.doesNotMatch(other, /<@/);
});

test("the round counter stays quiet until a product has taken three tries", () => {
  const third = { id: "r3", number: 3, state: "AWAITING_DECISION" as const, model: "uni-1", feedback: null, sheetFileId: "F3" };
  assert.doesNotMatch(text(view()), /round \d/);
  assert.doesNotMatch(text(view({ attempt: 2 })), /round \d/);
  assert.match(text(view({ round: third, attempt: 3 })), /round 3 of generation/);
  // A replaced source photo resets it, so the stored round number is not what shows.
  assert.doesNotMatch(text(view({ round: third, attempt: 1 })), /round \d/);
});

test("the leading emoji says what is happening now", () => {
  assert.match(text(view({ state: "GENERATING" })), /🔄 /);
  assert.match(text(view()), /🖼 /);
  assert.match(text(view({ state: "CLOSED", live: 1 })), /⚠️ /);
  assert.match(text(view({ live: 2, candidates: candidates(["SUCCEEDED"], [1]) })), /✅ /);
});

test("closed and short says it is waiting on a person, and stops offering rounds at the limit", () => {
  const closed = view({ state: "CLOSED", live: 1 });
  assert.match(text(closed), /has 1 approved image and needs 2/);
  assert.match(text(closed), /Nothing is queued — this is waiting on a person/);
  assert.deepEqual(actionIds(closed), ["round_more", "round_new_idea"]);
  const last = view({ state: "CLOSED", live: 0, round: { id: "r3", number: 3, state: "CLOSED", model: "uni-1", feedback: "less styled", sheetFileId: "F3" } });
  assert.deepEqual(actionIds(last), ["round_new_idea"]);
  assert.match(text(last), /That was round 3, the last one for this idea/);
});

test("published AI images carry the IPTC composite-with-AI marker (#16)", async () => {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#aabbcc" } }).jpeg().toBuffer();
  const xmp = aiProvenanceXmp({ sku: "HG-002", model: "uni-1", approvedAt: new Date("2026-09-16T00:00:00Z"), imageId: "abc" });
  const out = await sharp(jpeg).withXmp(xmp).jpeg().toBuffer();
  const meta = await sharp(out).metadata();
  const written = meta.xmp?.toString("utf8") ?? "";
  assert.match(written, /compositeWithTrainedAlgorithmicMedia/);
  assert.match(written, /Luma uni-1/);
});

test("reverting renders from what is live: back to untouched at 0, one fewer otherwise", () => {
  const untouched = view();
  // The only approval reverted: no progress line, no ✅ on any number — identical to never approved.
  const revertedToZero = view({ candidates: candidates(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]), live: 0 });
  assert.deepEqual(roundMessageBlocks(revertedToZero), roundMessageBlocks(untouched));
  // Done at 2, one reverted: the message un-collapses to "1 approved · needs 1 more".
  const revertedFromDone = view({ candidates: candidates(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"], [1]), live: 1 });
  assert.match(text(revertedFromDone), /✅ 1 approved · needs 1 more/);
  assert.doesNotMatch(text(revertedFromDone), /done —/);
});

test("a themed round counts only its own set: holiday candidates on an everyday-done product still show", () => {
  // HG-002 has 2 everyday images (done), and its holiday candidates just came back: live in the holiday set is 0.
  const holiday = view({ theme: "holiday", live: 0 });
  assert.deepEqual(actionIds(holiday), ["candidate_open_1", "candidate_open_2", "candidate_open_3", "candidate_open_4", "round_reject"]);
  assert.match(text(holiday), /🎨 holiday/);
  const one = view({ theme: "holiday", live: 1, candidates: candidates(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"], [4]) });
  assert.match(text(one), /✅ 1 approved for holiday · needs 1 more/);
  const done = view({ theme: "holiday", live: 2, candidates: candidates(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"], [1, 4]) });
  assert.match(text(done), /done — 2 approved holiday images, live now/);
});
