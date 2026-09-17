// Flow 4 in Slack. `/shots status` (everything), `/shots status q4-drop` (one drop),
// `/shots HG-002` (one product). Read-only and public in the channel: the requirement isn't a
// report, it's not having to ask Ellie — so the answer has to be cheaper to get than a message.
import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import { permalinkResolver, runDaily } from "../core/daily.js";
import { dropBlocks, everythingBlocks, productBlocks, stuckListBlocks, thinGalleryBlocks } from "../core/statusBlocks.js";
import { dropProducts, loadStatus, stuckItems, type Status } from "../core/status.js";
import type { Db } from "../lib/db.js";

type Respond = (msg: { response_type: "in_channel" | "ephemeral"; text: string; blocks?: KnownBlock[]; replace_original?: boolean }) => Promise<unknown>;

export const SKU_PATTERN = /^[a-z]{1,6}-?\d{1,6}[a-z]?$/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function statusCommand(db: Db, teamId: string, args: string[], respond: Respond) {
  const install = await db.install.findUnique({ where: { teamId } });
  if (!install) return respond({ response_type: "ephemeral", text: "I'm not set up yet — `/invite @shutter` to a channel first." });
  const status = await loadStatus(db, teamId);
  const query = args.join(" ").trim();

  if (!query) return respond({ response_type: "in_channel", text: "Status: everything", blocks: everythingBlocks(status) });
  if (SKU_PATTERN.test(query)) return productStatus(status, query, respond);

  // A drop by name, loosely: "q4-drop", "Q4 Drop" and "q4 drop" are the same request.
  const matches = status.drops.filter((d) => norm(d.name) === norm(query) || norm(d.name).startsWith(norm(query)));
  const drop = matches[0]; // drops are newest first; two drops with the same name → the latest
  if (!drop) {
    const names = status.drops.slice(0, 10).map((d) => `• ${d.name} (${d.importedAt.toISOString().slice(0, 10)})`);
    // A typo should not be a dead end.
    return respond({ response_type: "ephemeral", text: `I don't know a drop called “${query}”.${names.length ? `\n\nDrops:\n${names.join("\n")}` : ""}` });
  }
  return respond({ response_type: "in_channel", text: `Status: ${drop.name}`, blocks: dropBlocks(status, drop.id) });
}

export async function productStatus(status: Status, query: string, respond: Respond) {
  const product = status.products.find((p) => norm(p.sku) === norm(query));
  if (!product) {
    const close = status.products.filter((p) => norm(p.sku).includes(norm(query).replace(/^0+/, "")) || distance(norm(p.sku), norm(query)) <= 2).slice(0, 5);
    const hint = close.length ? `\nDid you mean ${close.map((p) => p.sku).join(", ")}?` : "";
    return respond({ response_type: "ephemeral", text: `I don't have a product ${query.toUpperCase()}.${hint}` });
  }
  return respond({ response_type: "in_channel", text: `Status: ${product.sku}`, blocks: productBlocks(status, product) });
}

export async function dailyCommand(db: Db, web: WebClient, log: Logger, teamId: string, respond: Respond) {
  // Runs today's post now — the 9am post can't be waited for in a demo — and counts as today's run.
  const { reports, nudged } = await runDaily(db, web, log, teamId);
  if (reports === 0 && nudged === 0) {
    return respond({ response_type: "ephemeral", text: "Nothing to post: no open drop has changed recently, and nothing is stuck. Silence is the default." });
  }
}

export function registerStatus({ app, db }: { app: App; db: Db }) {
  const scoped = async (teamId: string, scope: string) => {
    const status = await loadStatus(db, teamId);
    if (scope.startsWith("drop:")) {
      const dropId = scope.slice(5);
      return { status, products: dropProducts(status, dropId), drops: status.drops.filter((d) => d.id === dropId) };
    }
    return { status, products: status.products, drops: status.drops };
  };

  app.action("status_stuck", async ({ ack, body, client, respond }) => {
    await ack();
    const b = body as { team?: { id: string }; actions: { value: string }[] };
    const { status, products, drops } = await scoped(b.team!.id, b.actions[0]!.value);
    const items = stuckItems(status, products, drops);
    const heading = `⚠️  *${items.length === 1 ? "1 thing is" : `${items.length} things are`} stuck*`;
    await respond({ response_type: "ephemeral", replace_original: false, text: "Stuck", blocks: await stuckListBlocks(items, permalinkResolver(client), heading) });
  });

  app.action("status_thin", async ({ ack, body, client, respond }) => {
    await ack();
    const b = body as { team?: { id: string }; actions: { value: string }[] };
    const { status, products } = await scoped(b.team!.id, b.actions[0]!.value);
    await respond({ response_type: "ephemeral", replace_original: false, text: "Thin galleries", blocks: await thinGalleryBlocks(products, status, permalinkResolver(client)) });
  });
}

function distance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}
