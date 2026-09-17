// The updated CSV export (REQUIREMENTS Part 3): load-bearing since Drive was cut — the only bulk way
// to hand someone every approved image link. Two files, because products and events are different
// shapes (Flow 4, decision 4.4).
//
// products.csv leads with the sheet's own columns under their original headers, so the file can be
// dropped back in as an import (extra columns are ignored). Images: one column for the default set
// and one per theme, each a comma-separated list in display order, primary first — short cells, and
// an empty theme column shows at a glance which products are missing that set.
import type { Db } from "../lib/db.js";
import { publicImageUrl } from "../lib/storage.js";
import { productStage, STAGE_LABEL } from "./productStage.js";

/** RFC 4180 quoting, plus neutralising cells a spreadsheet would run as a formula. */
export function csvCell(value: string | number | null | undefined, { formula = true } = {}) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (formula && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null)[][], rawColumns: Set<number> = new Set()) {
  const line = (cells: (string | number | null)[]) => cells.map((c, i) => csvCell(c, { formula: !rawColumns.has(i) })).join(",");
  return [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
}

type NameOf = (userId: string | null) => Promise<string>;

export async function buildProductsCsv(db: Db, teamId: string, publicBaseUrl: string, nameOf: NameOf) {
  const [products, themes] = await Promise.all([
    db.product.findMany({
      where: { teamId },
      orderBy: { sku: "asc" },
      include: {
        images: { where: { revokedAt: null }, orderBy: [{ sortKey: "asc" }, { approvedAt: "asc" }] },
        ideas: { select: { state: true, createdAt: true, draftCostUsd: true } },
        rounds: { orderBy: { createdAt: "desc" }, include: { candidates: { select: { state: true, costUsd: true } } } },
      },
    }),
    db.theme.findMany({ where: { teamId }, orderBy: { name: "asc" } }),
  ]);

  const header = [
    "SKU", "Product Name", "Category", "Color / Finish", "Material", "Price", "Photo", "Shot Idea", "Notes",
    "Status", "Approved Images", "Last Approved By", "Last Approved At", "Spend (USD)",
    "Default Images", ...themes.map((t) => `Images: ${t.name}`),
  ];
  const linkColumns = new Set([6, 14, ...themes.map((_, i) => 15 + i)]);
  const links = (images: { publicKey: string }[]) => images.map((i) => publicImageUrl(publicBaseUrl, i.publicKey)).join(", ");

  const rows = [];
  for (const p of products) {
    const latest = p.rounds[0];
    const stage = productStage({
      live: p.images.length,
      hasSourcePhoto: p.currentSourcePhotoId !== null,
      ideas: p.ideas,
      latestRound: latest ? { state: latest.state, succeeded: latest.candidates.filter((c) => c.state === "SUCCEEDED").length } : null,
    });
    const lastApproved = [...p.images].sort((a, b) => +b.approvedAt - +a.approvedAt)[0];
    const spend =
      p.rounds.reduce((s, r) => s + r.candidates.reduce((t, c) => t + Number(c.costUsd ?? 0), 0), 0) +
      p.ideas.reduce((s, i) => s + Number(i.draftCostUsd ?? 0), 0);
    rows.push([
      p.sku, p.name, p.category, p.color, p.material, p.price, p.photoUrl, p.sheetShotIdea, p.notes,
      STAGE_LABEL[stage], p.images.length, lastApproved ? await nameOf(lastApproved.approvedBy) : null,
      lastApproved?.approvedAt.toISOString() ?? null, spend.toFixed(4),
      links(p.images.filter((i) => i.themeId === null)),
      ...themes.map((t) => links(p.images.filter((i) => i.themeId === t.id))),
    ]);
  }
  return { csv: toCsv(header, rows, linkColumns), products: products.length, images: products.reduce((n, p) => n + p.images.length, 0) };
}

export async function buildEventsCsv(db: Db, teamId: string, nameOf: NameOf) {
  const events = await db.event.findMany({ where: { teamId }, orderBy: { at: "asc" } });
  const productIds = [...new Set(events.map((e) => e.productId).filter((id): id is string => !!id))];
  const dropIds = [...new Set(events.map((e) => e.dropId).filter((id): id is string => !!id))];
  const [products, drops] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true } }),
    db.drop.findMany({ where: { id: { in: dropIds } }, select: { id: true, name: true } }),
  ]);
  const sku = new Map(products.map((p) => [p.id, p.sku]));
  const drop = new Map(drops.map((d) => [d.id, d.name]));

  const header = ["At", "Who", "Who (Slack ID)", "Event", "SKU", "Drop", "Details"];
  const rows = [];
  for (const e of events) {
    rows.push([
      e.at.toISOString(),
      e.actor === "system" ? "system" : await nameOf(e.actor),
      e.actor,
      e.type,
      e.productId ? (sku.get(e.productId) ?? null) : null,
      e.dropId ? (drop.get(e.dropId) ?? null) : null,
      e.data === null ? null : JSON.stringify(e.data),
    ]);
  }
  return { csv: toCsv(header, rows, new Set([6])), events: events.length };
}
