import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDraftRequest, type DraftInput } from "./drafting.js";

const product = (over: Partial<DraftInput["product"]> = {}): DraftInput["product"] => ({
  sku: "HG-002", name: "Stoneware Mug 12oz", category: "Ceramics", color: "Sage", material: "Stoneware",
  price: "$28", notes: "El: bestseller", sheetShotIdea: "morning kitchen counter", ...over,
});

test("the cached system prefix is identical for every product in a drop", () => {
  const shared = { houseStyle: "warm, lived-in", theme: { name: "holiday", look: "evergreen, candlelight" } };
  const a = buildDraftRequest({ ...shared, product: product() });
  const b = buildDraftRequest({ ...shared, product: product({ sku: "HG-041", name: "Tumbler", sheetShotIdea: null, notes: null }) });
  assert.deepEqual(a.system, b.system, "anything product-specific in system breaks caching across the drop");
  assert.ok(a.system.at(-1)?.cache_control, "the breakpoint sits on the last stable block");
  assert.notDeepEqual(a.messages, b.messages);
});

test("the product message carries the sheet idea and notes verbatim, or says there is no idea", () => {
  const withIdea = buildDraftRequest({ houseStyle: null, theme: null, product: product() }).messages[0]!.content;
  assert.match(withIdea, /Sheet idea: "morning kitchen counter"/);
  assert.match(withIdea, /Team notes: "El: bestseller"/);
  const blank = buildDraftRequest({ houseStyle: null, theme: null, product: product({ sheetShotIdea: null }) }).messages[0]!.content;
  assert.match(blank, /Sheet idea: none/);
});

test("no campaign never tells the model to drop a season the sheet idea names", () => {
  const { system } = buildDraftRequest({ houseStyle: null, theme: null, product: product() });
  const context = system.map((b) => b.text).join("\n");
  assert.doesNotMatch(context, /everyday, year-round/);
  assert.match(context, /keep it/);
});
