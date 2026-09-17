import assert from "node:assert/strict";
import { test } from "node:test";
import { endpointsMessage } from "./endpoints.js";
import type { Db } from "../lib/db.js";

// A stub standing in for the three reads endpointsMessage makes: the themes with their live image
// counts, the default set's count, and one SKU worth pasting into a terminal.
const db = (over: { themes?: { name: string; images: number }[]; defaults?: number; example?: { sku: string; theme: string | null } | null }) =>
  ({
    theme: { findMany: async () => (over.themes ?? []).map((t) => ({ name: t.name, _count: { images: t.images } })) },
    image: {
      count: async () => over.defaults ?? 0,
      findFirst: async () =>
        over.example === undefined || over.example === null
          ? null
          : { product: { sku: over.example.sku }, theme: over.example.theme ? { name: over.example.theme } : null },
    },
    product: { findFirst: async () => null },
  }) as unknown as Db;

const render = async (d: Db) => (await endpointsMessage(d, "T1", "https://shots.example.com/")).blocks
  .map((b) => (b.type === "section" && "text" in b && b.text ? b.text.text : ""))
  .join("\n");

test("every theme is listed as the query argument the site actually sends", async () => {
  const out = await render(db({ themes: [{ name: "holiday", images: 4 }, { name: "spring", images: 0 }], defaults: 12 }));
  assert.match(out, /`default`  — 12 images/);
  assert.match(out, /`\?theme=holiday`  — 4 images/);
  // An empty theme is listed, not hidden: asking for it works, it just falls back.
  assert.match(out, /`\?theme=spring`  — 0 images.*falls back to default/);
});

test("the trailing slash on the base URL never doubles up", async () => {
  const out = await render(db({}));
  assert.match(out, /GET https:\/\/shots\.example\.com\/products\/\{SKU\}\/images/);
  assert.doesNotMatch(out, /com\/\/products/);
});

test("the example is a SKU that returns something, with the theme it was approved under", async () => {
  const withImages = await render(db({ themes: [{ name: "holiday", images: 4 }], example: { sku: "HG-041", theme: "holiday" } }));
  assert.match(withImages, /curl 'https:\/\/shots\.example\.com\/products\/HG-041\/images\?theme=holiday'/);
  assert.match(withImages, /"served_theme": "holiday"/);
  // Nothing approved yet: a plain call, and requested_theme is null rather than a theme that would 404-ish.
  const empty = await render(db({}));
  assert.match(empty, /curl '.*\/products\/HG-002\/images'/);
  assert.match(empty, /"requested_theme": null/);
});

test("the contract states the two things a caching site gets wrong", async () => {
  const out = await render(db({}));
  assert.match(out, /URLs are immutable/);
  assert.match(out, /503.*[Dd]on't cache it/s);
  assert.match(out, /unknown SKU is `200`/);
});
