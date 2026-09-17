import assert from "node:assert/strict";
import { test } from "node:test";
import { ideaFor } from "./ideaQueue.js";

const everyday = { dropId: "d1", themeId: null, mode: "EXPAND", rawSheetIdea: "morning counter" };

test("a new product is drafted for whatever campaign is chosen, expanding its sheet idea", () => {
  assert.equal(ideaFor({ ideas: [], dropId: "d2", themeId: null, sheet: "morning counter", newSheetIdea: false }), "EXPAND");
  assert.equal(ideaFor({ ideas: [], dropId: "d2", themeId: "holiday", sheet: null, newSheetIdea: false }), "DRAFT");
});

test("re-importing with no campaign drafts nothing for a product that already has everyday ideas", () => {
  assert.equal(ideaFor({ ideas: [everyday], dropId: "d2", themeId: null, sheet: "morning counter", newSheetIdea: false }), null);
});

test("choosing a campaign starts it for an existing product — as fresh drafts, not a second expansion", () => {
  assert.equal(ideaFor({ ideas: [everyday], dropId: "d2", themeId: "holiday", sheet: "morning counter", newSheetIdea: false }), "DRAFT");
});

test("a changed sheet idea drafts even when the campaign already has ideas, and expands the new idea", () => {
  assert.equal(ideaFor({ ideas: [everyday], dropId: "d2", themeId: null, sheet: "steam by a window", newSheetIdea: true }), "EXPAND");
});

test("nothing is queued twice for the same drop", () => {
  assert.equal(ideaFor({ ideas: [{ ...everyday, dropId: "d2", themeId: "holiday" }], dropId: "d2", themeId: "holiday", sheet: null, newSheetIdea: true }), null);
});
