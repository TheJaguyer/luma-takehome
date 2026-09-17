// Flow 4's messages: three zoom levels, the stuck list, nudges and the drop's own posts. Every
// stuck row carries the way to unblock it — a link to the product's message, where the button is —
// because a stuck list that only reports is a dashboard with extra steps.
import type { KnownBlock } from "@slack/types";
import { usd } from "./ideaCards.js";
import {
  age,
  DONE_AT,
  dropProducts,
  dropProgress,
  PAGE_IMAGES,
  startOfMonth,
  stuckItems,
  type ProductStatus,
  type Status,
  type Waiting,
  type WaitingOn,
} from "./status.js";

export type LinkResolver = (link: Waiting["link"]) => Promise<string | null>;

const section = (text: string): KnownBlock => ({ type: "section", text: { type: "mrkdwn", text } });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const STAGE_LINES: [ProductStatus["stage"][], string, string][] = [
  [["done"], "✅", "done  (2+ approved images)"],
  [["awaiting_decision"], "🖼", "awaiting a decision"],
  [["generating"], "🎨", "generating"],
  [["ideas_awaiting_review", "drafting"], "💡", "ideas awaiting review"],
  [["waiting_on_person"], "⚠️", "short — waiting on a person"],
  [["needs_source_photo"], "📷", "need a source photo"],
  // Skipped is a decision someone made; not started is one nobody has. Rolled together they read
  // as one pile of neglect, and only half of it is.
  [["skipped"], "⏭", "skipped"],
  [["not_started"], "⏸", "not started"],
];

type StageRow = { stage: ProductStatus["stage"]; generating?: number; link?: Waiting["link"] };

/**
 * One line per stage that has anything in it, each one tappable: products are already ordered
 * priority-first, so the link goes to the first product in that stage — which is the one anybody
 * reading "1 awaiting a decision" wants to open. A count you can't act on is a dashboard.
 */
async function stageLines(products: StageRow[], resolve: LinkResolver) {
  const lines = await Promise.all(
    STAGE_LINES.map(async ([stages, icon, label]) => {
      const inStage = products.filter((p) => stages.includes(p.stage));
      if (!inStage.length) return null;
      const url = await firstLink(inStage, resolve);
      const text = `${inStage.length} ${label}`;
      return `${icon}  ${url ? `<${url}|${text}>` : text}`;
    }),
  );
  // Money in the air, whatever stage it rolls up to (a done product can have a holiday round out).
  const generating = products.reduce((n, p) => n + (p.generating ?? 0), 0);
  if (generating) {
    const url = await firstLink(products.filter((p) => p.generating), resolve);
    const text = `${plural(generating, "image")} generating now`;
    lines.push(`⏳  ${url ? `<${url}|${text}>` : text}`);
  }
  return lines.filter(Boolean) as string[];
}

// Bounded: a permalink that fails to resolve costs an API call, and at 300 products a stage whose
// links are all stale would spend 300 of them to render one line. The first few or nothing.
async function firstLink(rows: StageRow[], resolve: LinkResolver) {
  for (const row of rows.slice(0, 5)) {
    const url = row.link ? await resolve(row.link) : null;
    if (url) return url;
  }
  return null;
}

/** Done never moves because of a thin gallery, and a thin gallery never blocks: two signals (#4c vs #5a). */
function thin(products: ProductStatus[]) {
  return products.filter((p) => p.stage === "done" && p.live < PAGE_IMAGES);
}

function bar(done: number, total: number, width = 17) {
  const filled = total ? Math.round((done / total) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export async function everythingBlocks(status: Status, resolve: LinkResolver, now = new Date()): Promise<KnownBlock[]> {
  const { products } = status;
  if (products.length === 0) return [section("📊  Nothing imported yet. Drop a CSV export in the review channel to start.")];
  const stuck = stuckItems(status, products, status.drops, now);
  const thinGallery = thin(products);
  const month = products.reduce((s, p) => s + p.spend.since(startOfMonth(now)), 0);
  const all = products.reduce((s, p) => s + p.spend.total, 0);
  const lines = [
    `📊  *Everything · ${plural(products.length, "product")}*`,
    "",
    ...(await stageLines(products, resolve)),
    "",
    stuck.length ? `⚠️  ${stuck.length} stuck` : "✅  Nothing is stuck",
    thinGallery.length ? `🖼  ${plural(thinGallery.length, "product")} would show a thin gallery (fewer than ${PAGE_IMAGES} images)` : null,
    `💰  ${usd(month)} this month · ${usd(all)} all time`,
  ].filter((l) => l !== null);
  return withButtons(section(lines.join("\n")), stuck.length > 0, thinGallery.length > 0, "all");
}

export async function dropBlocks(status: Status, dropId: string, resolve: LinkResolver, opts: { title?: string; now?: Date } = {}): Promise<KnownBlock[]> {
  const now = opts.now ?? new Date();
  const drop = status.drops.find((d) => d.id === dropId)!;
  const products = dropProducts(status, dropId);
  // A drop reports on its own campaign: done means 2 images in that set.
  const progress = dropProgress(status, dropId);
  const done = progress.filter((p) => p.stage === "done").length;
  const stuck = stuckItems(status, products, [drop], now);
  const awaiting = progress.filter((p) => p.stage === "awaiting_decision" && p.product.priority).map((p) => p.product.sku);
  const date = drop.importedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const spend = products.reduce((s, p) => s + p.spend.total, 0);
  const campaignName = drop.themeId ? status.themes.get(drop.themeId) : null;
  const lines = [
    `📊  *${opts.title ?? `${drop.name} · imported ${date}`} · ${plural(products.length, "product")}*${campaignName ? `   🎨 ${campaignName}` : ""}`,
    `${bar(done, products.length)}  ${done} of ${products.length} done`,
    "",
    ...(await stageLines(progress, resolve)).filter((l) => !l.startsWith("✅")),
    awaiting.length ? `⭐  Priority waiting on a decision: ${awaiting.join(", ")}` : null,
    drop.waiting ? `⚠️  The theme question hasn't been answered, so no ideas are drafted yet` : null,
    "",
    stuck.length ? `⚠️  ${stuck.length} stuck` : "✅  Nothing is stuck",
    `💰  ${usd(spend)} spent on these products`,
  ].filter((l) => l !== null);
  return withButtons(section(lines.join("\n")), stuck.length > 0, thin(products).length > 0, `drop:${dropId}`);
}

export function productBlocks(status: Status, p: ProductStatus, now = new Date()): KnownBlock[] {
  const title = [p.sku, p.name, p.color].filter(Boolean).join(" · ");
  const headline =
    p.stage === "done"
      ? `✅  Done — ${plural(p.live, "approved image")}${p.generating ? ` · ${plural(p.generating, "more image")} generating` : ""}`
      : p.waiting
        ? `${stageIcon(p.stage)}  ${p.waiting.what} · waiting on ${WHO[p.waiting.on]} · ${age(p.waiting.since, now)}`
        : `${stageIcon(p.stage)}  ${p.stage.replace(/_/g, " ")}`;
  const sets = [...p.liveByTheme.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([theme, n]) => `${n} ${theme ?? "default"}`);
  const lines = [
    `📊  *${title}*${p.priority ? "   ⭐ priority" : ""}`,
    headline,
    "",
    // Split by theme: "3 approved" doesn't say whether a holiday page will render a full gallery.
    `*Images*   ${p.live ? `${p.live} approved · ${sets.join(" · ")}` : "none approved yet"}`,
    p.stage === "skipped" ? `*Skipped*  its card in the channel has *[Review again]*` : null,
    p.ideaHeadline ? `*Idea*     “${p.ideaHeadline}”${p.ideaDecidedBy ? ` · approved by <@${p.ideaDecidedBy}>` : ""}` : null,
    p.generating ? `*In flight* ${plural(p.generating, "image")} generating now` : null,
    ...p.rounds.map((r) => `*Round ${r.number}*  ${r.candidates} candidates · ${usd(r.cost)} · ${r.approved} approved`),
    `*Spend*    ${usd(p.spend.total)}`,
  ].filter((l) => l !== null);
  return [section(lines.join("\n"))];
}

const WHO: Record<WaitingOn, string> = {
  approver: "an approver",
  anyone: "anyone",
  nobody: "nobody",
  system: "the system",
  settings: "a settings change",
};

const GROUPS: [WaitingOn, string][] = [
  ["approver", "Waiting on an approver"],
  ["anyone", "Waiting on anyone"],
  ["system", "Waiting on the system"],
  ["settings", "Waiting on a settings change"],
  // Rendered last and labelled plainly: these are in no queue, and this is the only place they show.
  ["nobody", "Waiting on nobody   ← these are in no queue"],
];

/** Organised by who it is waiting on, not by stage (Flow 4, Step 5). */
export async function stuckListBlocks(items: ReturnType<typeof stuckItems>, resolve: LinkResolver, heading: string, now = new Date()): Promise<KnownBlock[]> {
  if (items.length === 0) return [section("✅  Nothing is stuck.")];
  const blocks: KnownBlock[] = [section(heading)];
  for (const [on, label] of GROUPS) {
    const group = items.filter((i) => i.waiting.on === on);
    if (!group.length) continue;
    const rows = await Promise.all(
      group.slice(0, 12).map(async (i) => {
        const url = await resolve(i.waiting.link);
        const name = url ? `<${url}|${i.label}>` : i.label;
        return `${name}${i.priority ? " ⭐" : ""}   ${i.waiting.what}, ${age(i.waiting.since, now)}`;
      }),
    );
    if (group.length > 12) rows.push(`…and ${group.length - 12} more`);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${label}*\n${rows.join("\n")}` } });
  }
  // The one stuck row with a fix that is not a tap on the row itself (Flow 6).
  if (items.some((i) => i.waiting.what === "needs a source photo")) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "📷 *Needs a source photo:* drop a photo in this channel and pick *A new product photo* — it replaces the source and generates in one gesture." }],
    });
  }
  return blocks;
}

export async function thinGalleryBlocks(products: ProductStatus[], status: Status, resolve: LinkResolver): Promise<KnownBlock[]> {
  const list = thin(products);
  if (!list.length) return [section(`🖼  Every done product has at least ${PAGE_IMAGES} images.`)];
  const rows = await Promise.all(
    list.slice(0, 15).map(async (p) => {
      const url = await resolve(p.waiting?.link ?? null);
      const sets = [...p.liveByTheme.entries()].map(([t, n]) => `${n} ${t ?? "default"}`).join(" · ");
      return `${url ? `<${url}|${p.sku}>` : p.sku}   ${sets}`;
    }),
  );
  return [section(`🖼  *${plural(list.length, "product")} would show fewer than ${PAGE_IMAGES} images*\n${rows.join("\n")}`)];
}

function stageIcon(stage: ProductStatus["stage"]) {
  return STAGE_LINES.find(([stages]) => stages.includes(stage))?.[1] ?? "•";
}

function withButtons(block: KnownBlock, stuck: boolean, thinGallery: boolean, scope: string): KnownBlock[] {
  const elements = [
    ...(stuck ? [{ type: "button" as const, action_id: "status_stuck", text: { type: "plain_text" as const, text: "Show stuck" }, value: scope }] : []),
    ...(thinGallery ? [{ type: "button" as const, action_id: "status_thin", text: { type: "plain_text" as const, text: "Show thin galleries" }, value: scope }] : []),
  ];
  return elements.length ? [block, { type: "actions", elements }] : [block];
}

export { DONE_AT };
