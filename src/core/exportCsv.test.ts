import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCatalogCsv } from "./catalogCsv.js";
import { csvCell, toCsv } from "./exportCsv.js";
import { productStage } from "./productStage.js";

test("cells are quoted per RFC 4180, and formula-looking text is neutralised", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("https://a/1.jpg, https://a/2.jpg", { formula: false }), '"https://a/1.jpg, https://a/2.jpg"');
});

test("an exported products.csv re-imports: sheet columns parse, the added ones are ignored", () => {
  const csv = toCsv(
    ["SKU", "Product Name", "Category", "Color / Finish", "Material", "Price", "Photo", "Shot Idea", "Notes", "Status", "Default Images", "Images: holiday"],
    [["HG-002", "Stoneware Mug 12oz", "Ceramics", "Sage", "Stoneware", "$28", "https://x/hg-002.jpg", "morning counter, steam", "El: first", "Done", "https://h/images/HG-002/a.jpg, https://h/images/HG-002/b.jpg", ""]],
    new Set([6, 10, 11]),
  );
  const parsed = parseCatalogCsv(csv);
  assert.ok(parsed.ok);
  assert.equal(parsed.rows[0]!.sku, "HG-002");
  assert.equal(parsed.rows[0]!.shotIdea, "morning counter, steam");
  assert.equal(parsed.rows[0]!.photoUrl, "https://x/hg-002.jpg");
});

test("stages roll up to one state per product", () => {
  const idea = (state: string, t = 1) => ({ state, createdAt: new Date(t) });
  assert.equal(productStage({ live: 2, hasSourcePhoto: true, ideas: [], latestRound: null }), "done");
  assert.equal(productStage({ live: 0, hasSourcePhoto: true, ideas: [], latestRound: null }), "not_started");
  assert.equal(productStage({ live: 0, hasSourcePhoto: false, ideas: [idea("AWAITING_REVIEW")], latestRound: null }), "ideas_awaiting_review");
  assert.equal(productStage({ live: 0, hasSourcePhoto: false, ideas: [idea("APPROVED")], latestRound: null }), "needs_source_photo");
  assert.equal(productStage({ live: 1, hasSourcePhoto: true, ideas: [idea("APPROVED")], latestRound: { state: "CLOSED", succeeded: 4 } }), "waiting_on_person");
  assert.equal(productStage({ live: 0, hasSourcePhoto: true, ideas: [idea("APPROVED")], latestRound: { state: "GENERATING", succeeded: 0 } }), "generating");
  // A superseded idea never decides the stage; its replacement does.
  assert.equal(productStage({ live: 0, hasSourcePhoto: true, ideas: [idea("SUPERSEDED", 1), idea("DRAFTING", 2)], latestRound: null }), "drafting");
});
