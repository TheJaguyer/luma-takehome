import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { changedFields, parseCatalogCsv } from "./catalogCsv.js";
import { dropNameFromFilename } from "./dropName.js";

const catalog = readFileSync(new URL("../../data/catalog.csv", import.meta.url), "utf8");

test("the real export parses with nothing rejected", () => {
  const parsed = parseCatalogCsv(catalog);
  assert.ok(parsed.ok);
  assert.equal(parsed.rejected.length, 0);
  assert.equal(parsed.rows.length, 40);
  const mug = parsed.rows.find((r) => r.sku === "HG-002")!;
  assert.equal(mug.name, "Stoneware Mug 12oz");
  assert.equal(mug.color, "Sage");
  assert.equal(mug.shotIdea, "morning kitchen counter, steam, warm light");
  assert.equal(mug.notes, "El: bestseller, do this one first");
  assert.equal(parsed.rows.find((r) => r.sku === "HG-001")!.shotIdea, null);
});

test("headers match loosely and unknown columns are ignored", () => {
  const parsed = parseCatalogCsv("﻿ sku ,COLOUR_finish,Photo URL,Supplier\nhg-100,Oat,https://x/1.jpg,Acme\n");
  assert.ok(parsed.ok);
  assert.deepEqual(
    { sku: parsed.rows[0]!.sku, color: parsed.rows[0]!.color, photo: parsed.rows[0]!.photoUrl },
    { sku: "HG-100", color: "Oat", photo: "https://x/1.jpg" },
  );
});

test("a missing SKU or Photo column rejects the whole file and names the headers found", () => {
  const parsed = parseCatalogCsv("Product Name,Price\nMug,$28\n");
  assert.equal(parsed.ok, false);
  assert.match(!parsed.ok ? parsed.reason : "", /SKU and Photo.*"Product Name", "Price"/);
});

test("only broken identity rejects a row, and every copy of a duplicate is rejected", () => {
  const parsed = parseCatalogCsv(
    "SKU,Photo\nHG-1,https://a\n,https://b\nHG-2,https://c\nHG-2,https://d\nHG-3,\n",
  );
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.rows.map((r) => r.sku), ["HG-1", "HG-3"]);
  assert.deepEqual(
    parsed.rejected.map((r) => [r.line, r.reason]),
    [
      [3, "missing SKU"],
      [4, "SKU appears 2 times in the file"],
      [5, "SKU appears 2 times in the file"],
    ],
  );
});

test("blank incoming cells never count as a change", () => {
  const current = { name: "Mug", category: "Ceramics", color: "Sage", material: null, price: "$28", notes: "x", photoUrl: "https://a" };
  const row = { line: 2, sku: "HG-1", name: "Mug", category: null, color: "Forest", material: "Stoneware", price: null, notes: null, photoUrl: "https://a", shotIdea: null };
  assert.deepEqual(changedFields(current, row), ["color", "material"]);
});

test("drop names come from the filename, or the date when the filename is junk", () => {
  const on = new Date("2026-09-16T12:00:00Z");
  assert.equal(dropNameFromFilename("catalog-q4-drop.csv", on), "Q4 Drop");
  assert.equal(dropNameFromFilename("Spring_Launch_export (2).csv", on), "Spring Launch");
  assert.equal(dropNameFromFilename("export(3).csv", on), "Import of Sep 16");
  assert.equal(dropNameFromFilename("catalog.csv", on), "Import of Sep 16");
});

test("the import summary stays inside Slack's limits and asks the campaign question once", async () => {
  const { importSummaryBlocks } = await import("./importSummary.js");
  const report = {
    rowCount: 300, created: Array.from({ length: 290 }, (_, i) => `HG-${i}`), newIdeas: [], unchanged: 10,
    notApplied: [], rejected: [], photoProblems: [], toDraft: 290, houseStyleSkipped: true,
    needsPhoto: Array.from({ length: 120 }, (_, i) => `HG-${i}`),
  };
  const drop = { id: "d1", name: "Q4 Drop", filename: "q4.csv", themeAnsweredAt: null, themeAnsweredBy: null, state: "AWAITING_THEME" };
  const themes = [{ id: "t1", name: "holiday" }, { id: "t2", name: "halloween" }];
  const blocks = importSummaryBlocks({ drop, report, themeName: null, themes });
  const json = JSON.stringify(blocks);
  assert.ok(json.includes("and 110 more"));
  for (const b of blocks) if (b.type === "section") assert.ok((b.text?.text.length ?? 0) <= 3000);
  const actionIds = blocks.flatMap((b) => (b.type === "actions" ? b.elements.map((e) => ("action_id" in e ? e.action_id : "")) : []));
  assert.equal(new Set(actionIds).size, actionIds.length, "Slack rejects duplicate action_ids in one message");

  const answered = importSummaryBlocks({ drop: { ...drop, themeAnsweredAt: new Date(), themeAnsweredBy: "U1" }, report, themeName: "holiday", themes });
  assert.ok(!JSON.stringify(answered).includes("drop_theme_"));
  assert.ok(JSON.stringify(answered).includes("*holiday*"));
});
