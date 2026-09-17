// Flow 1, Step 7 → Flow 2, Step 1–2, as reconciliation steps:
//   (ideas are created when the campaign question is answered — src/core/ideaQueue.ts)
//   draftPending  DRAFTING ideas are drafted by Claude (retried; DRAFT_FAILED after 3 tries)
//   openDrops     once nothing in a drop is still drafting, post its queue message → OPEN
//   postCards     cards for ideas awaiting review are posted a few per tick (Slack rate limits)
import type Anthropic from "@anthropic-ai/sdk";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import { DRAFT_MODEL, DraftError, draftIdeaOptions } from "../core/drafting.js";
import { ideaCardBlocks, productTitle, queueMessageBlocks } from "../core/ideaCards.js";
import { loadCardIdea } from "../core/ideaQueries.js";
import { Prisma } from "../generated/prisma/client.js";
import type { Db } from "../lib/db.js";
import { EDIT_PRICE_USD } from "../lib/luma.js";

type Deps = { db: Db; web: WebClient; log: Logger; claude: Anthropic };

const MAX_DRAFT_ATTEMPTS = 3;
const DRAFT_CONCURRENCY = 8;
const CARDS_PER_TICK = 5;

export async function draftPending({ db, log, claude }: Deps) {
  const ideas = await db.idea.findMany({
    where: { state: "DRAFTING", draftAttempts: { lt: MAX_DRAFT_ATTEMPTS } },
    include: { product: true, theme: true },
    orderBy: { createdAt: "asc" },
    take: DRAFT_CONCURRENCY,
  });

  await Promise.all(
    ideas.map(async (idea) => {
      const started = Date.now();
      try {
        const result = await draftIdeaOptions(claude, {
          houseStyle: idea.houseStyleUsed,
          theme: idea.theme ? { name: idea.theme.name, look: idea.themeLookUsed ?? idea.theme.look } : null,
          // A redraft is always from product data: re-expanding the same sheet idea would return the same scene.
          product: { ...idea.product, sheetShotIdea: idea.mode === "EXPAND" ? idea.rawSheetIdea : null },
          supersedes: idea.supersedes,
        });
        await db.$transaction([
          db.ideaOption.createMany({
            skipDuplicates: true,
            data: result.options.map((o, i) => ({ ideaId: idea.id, position: i + 1, headline: o.headline.trim(), prompt: o.scene.trim() })),
          }),
          db.idea.update({
            where: { id: idea.id },
            data: {
              state: "AWAITING_REVIEW",
              draftModel: DRAFT_MODEL,
              draftCostUsd: new Prisma.Decimal(result.costUsd.toFixed(5)),
              draftedAt: new Date(),
              draftError: null,
              draftAttempts: { increment: 1 },
            },
          }),
        ]);
        log.info(
          { idea: idea.id, sku: idea.product.sku, seconds: (Date.now() - started) / 1000, usd: result.costUsd, ...result.usage },
          "idea drafted",
        );
      } catch (err) {
        const retryable = err instanceof DraftError ? err.retryable : false;
        const attempts = idea.draftAttempts + 1;
        const exhausted = !retryable || attempts >= MAX_DRAFT_ATTEMPTS;
        await db.idea.update({
          where: { id: idea.id },
          data: {
            draftAttempts: attempts,
            draftError: (err as Error).message,
            ...(exhausted ? { state: "DRAFT_FAILED" as const } : {}),
          },
        });
        log.warn({ idea: idea.id, sku: idea.product.sku, attempts, exhausted, err: (err as Error).message }, "drafting failed");
      }
    }),
  );
}

export async function openDrops({ db, web, log }: Deps) {
  const drops = await db.drop.findMany({
    where: { state: "DRAFTING", queueTs: null, ideas: { some: {}, none: { state: "DRAFTING" } } },
    include: { ideas: { include: { product: true } } },
  });
  for (const drop of drops) {
    const install = await db.install.findUniqueOrThrow({ where: { teamId: drop.teamId } });
    if (!install.channelId) continue;
    const ready = drop.ideas.filter((i) => i.state === "AWAITING_REVIEW");
    const failed = drop.ideas.filter((i) => i.state === "DRAFT_FAILED").map((i) => i.product.sku);
    const model = install.defaultModel;
    const message = await web.chat.postMessage({
      channel: install.channelId,
      text: `${ready.length} ideas ready to review — ${drop.name}`,
      blocks: queueMessageBlocks({
        dropName: drop.name,
        ready: ready.length,
        priority: ready.filter((i) => i.product.priority).map((i) => i.product.sku),
        failed,
        candidatesPerRound: install.candidatesPerRound,
        estimateUsd: ready.length * install.candidatesPerRound * (EDIT_PRICE_USD[model] ?? 0),
      }),
    });
    const draftSpend = drop.ideas.reduce((sum, i) => sum + Number(i.draftCostUsd ?? 0), 0);
    await db.$transaction([
      db.drop.update({ where: { id: drop.id }, data: { state: "OPEN", queueTs: message.ts ?? null, lastProgressAt: new Date() } }),
      db.event.create({
        data: { teamId: drop.teamId, actor: "system", type: "drop.drafted", dropId: drop.id, data: { ready: ready.length, failed: failed.length, draftSpendUsd: draftSpend } },
      }),
    ]);
    log.info({ drop: drop.id, ready: ready.length, failed: failed.length, draftSpendUsd: draftSpend }, "idea queue posted");
  }
}

export async function postCards({ db, web, log }: Deps) {
  const ideas = await db.idea.findMany({
    where: { state: "AWAITING_REVIEW", cardShownAt: null, OR: [{ dropId: null }, { drop: { queueTs: { not: null } } }] },
    // Priority products first (#7), then by SKU.
    orderBy: [{ product: { priority: "desc" } }, { product: { sku: "asc" } }],
    select: { id: true, teamId: true },
    take: CARDS_PER_TICK,
  });
  for (const { id, teamId } of ideas) {
    const install = await db.install.findUniqueOrThrow({ where: { teamId } });
    const card = await loadCardIdea(db, id);
    if (!card || !install.channelId) continue;
    const text = `Idea review: ${productTitle(card.product)}`;
    let channel = card.cardChannelId;
    let ts = card.cardTs;
    if (channel && ts) {
      // A replacement idea takes over the product's existing message.
      await web.chat.update({ channel, ts, text, blocks: ideaCardBlocks(card) });
    } else {
      const message = await web.chat.postMessage({ channel: install.channelId, text, blocks: ideaCardBlocks(card), unfurl_links: false, unfurl_media: false });
      channel = message.channel ?? install.channelId;
      ts = message.ts ?? null;
    }
    await db.idea.update({ where: { id }, data: { cardChannelId: channel, cardTs: ts, cardShownAt: new Date() } });
    log.debug({ idea: id }, "idea card posted");
  }
}
