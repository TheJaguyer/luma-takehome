// Flow 4: where things stand, and what is waiting on whom. One load, three zoom levels, and the
// same data feeds nudges and the drop's daily post — so a nudge can never name something status
// doesn't show.
import type { Db } from "../lib/db.js";
import { productStage, type Stage } from "./productStage.js";
import { DONE_AT } from "./imageApproval.js";

export { DONE_AT };
export const PAGE_IMAGES = 3; // #4c: a product page uses about three

export type WaitingOn = "approver" | "anyone" | "nobody" | "system" | "settings";

export type Waiting = {
  on: WaitingOn;
  what: string; // "candidates", "1 of 2 approved", "needs a source photo" …
  since: Date;
  link: { channel: string; ts: string } | null;
};

export type Progress = { stage: Stage; live: number; waiting: Waiting | null };

export type ProductStatus = {
  id: string;
  sku: string;
  name: string | null;
  color: string | null;
  priority: boolean;
  stage: Stage;
  live: number;
  liveByTheme: Map<string | null, number>; // null = default set
  spend: { total: number; since: (d: Date) => number };
  waiting: Waiting | null;
  /**
   * Progress within one campaign (null = everyday): stage from that campaign's latest idea, done at
   * 2 images in that set. A drop reports on its own campaign, so a holiday run on a product that is
   * already done with everyday images still reads as "awaiting a decision" in the holiday drop.
   */
  forCampaign: (themeId: string | null) => Progress;
  dropIds: string[];
  ideaHeadline: string | null;
  ideaDecidedBy: string | null;
  ideaDecidedAt: Date | null;
  rounds: { number: number; candidates: number; cost: number; approved: number; state: string }[];
};

export type DropStatus = {
  id: string;
  name: string;
  importedAt: Date;
  state: string;
  themeId: string | null;
  productIds: string[];
  waiting: Waiting | null; // the unanswered campaign question
  lastActivityAt: Date;
};

export type StatusThresholds = { stuckAfterMs: number; systemStuckAfterMs: number };

export function thresholds(install: { nudgeAfterDays: number }): StatusThresholds {
  // STUCK_AFTER_MINUTES shortens the wait for demos and testing; the team's setting is in days.
  const override = Number(process.env.STUCK_AFTER_MINUTES);
  return {
    stuckAfterMs: override > 0 ? override * 60_000 : install.nudgeAfterDays * 86_400_000,
    systemStuckAfterMs: override > 0 ? override * 60_000 : 30 * 60_000,
  };
}

export function isStuck(w: Waiting | null, t: StatusThresholds, now = new Date()) {
  if (!w) return false;
  const age = now.getTime() - w.since.getTime();
  return age >= (w.on === "system" ? t.systemStuckAfterMs : t.stuckAfterMs);
}

export async function loadStatus(db: Db, teamId: string) {
  const install = await db.install.findUniqueOrThrow({ where: { teamId } });
  const [products, drops, themes] = await Promise.all([
    db.product.findMany({
      where: { teamId, archivedAt: null }, // archived products are excluded from every count (#6)
      orderBy: [{ priority: "desc" }, { sku: "asc" }],
      include: {
        images: { where: { revokedAt: null }, select: { themeId: true } },
        drops: { select: { dropId: true } },
        ideas: { orderBy: { createdAt: "desc" }, include: { approvedOption: true } },
        rounds: {
          orderBy: { createdAt: "desc" },
          include: { candidates: { select: { state: true, costUsd: true, submittedAt: true, image: { select: { revokedAt: true } } } } },
        },
      },
    }),
    db.drop.findMany({ where: { teamId, state: { not: "FAILED" } }, orderBy: { importedAt: "desc" }, include: { products: { select: { productId: true } } } }),
    db.theme.findMany({ where: { teamId } }),
  ]);
  const themeName = new Map(themes.map((t) => [t.id, t.name]));

  const statuses: ProductStatus[] = products.map((p) => {
    const images = (themeId: string | null | undefined) => (themeId === undefined ? p.images : p.images.filter((i) => i.themeId === themeId));

    // One definition of stage and "waiting on", applied to all of a product's ideas (product level)
    // or to one campaign's ideas and images (drop level).
    const evaluate = (themeId: string | null | undefined): Progress & { idea: (typeof p.ideas)[number] | null } => {
      const ideas = themeId === undefined ? p.ideas : p.ideas.filter((i) => i.themeId === themeId);
      const idea = ideas.find((i) => i.state !== "SUPERSEDED") ?? null;
      const rounds = themeId === undefined ? p.rounds : p.rounds.filter((r) => ideas.some((i) => i.id === r.ideaId));
      const latest = rounds[0] ?? null;
      const succeeded = latest?.candidates.filter((c) => c.state === "SUCCEEDED").length ?? 0;
      const live = images(themeId).length;
      const stage = productStage({
        live,
        hasSourcePhoto: p.currentSourcePhotoId !== null,
        ideas,
        latestRound: latest ? { state: latest.state, succeeded } : null,
      });
      const label = themeId ? ` (${themeName.get(themeId) ?? "theme"})` : "";
      const roundLink = latest?.messageChannelId && latest.messageTs ? { channel: latest.messageChannelId, ts: latest.messageTs } : null;
      const ideaLink = idea?.cardChannelId && idea.cardTs ? { channel: idea.cardChannelId, ts: idea.cardTs } : null;
      let waiting: Waiting | null = null;
      switch (stage) {
        case "ideas_awaiting_review":
          waiting = { on: "approver", what: `ideas${label}`, since: idea!.cardShownAt ?? idea!.draftedAt ?? idea!.createdAt, link: ideaLink };
          break;
        case "awaiting_decision":
          waiting = { on: "approver", what: `candidates${label}`, since: latest!.completedAt ?? latest!.createdAt, link: roundLink };
          break;
        case "generating":
          waiting = { on: "system", what: `generating${label}`, since: latest!.createdAt, link: roundLink };
          break;
        case "needs_source_photo":
          waiting = { on: "anyone", what: "needs a source photo", since: p.createdAt, link: ideaLink };
          break;
        case "drafting":
          if (idea?.state === "DRAFT_FAILED") waiting = { on: "anyone", what: `drafting failed${label} — \`/shots ideas\` retries`, since: idea.createdAt, link: null };
          break;
        case "waiting_on_person": {
          const since = latest?.rejectedAt ?? latest?.completedAt ?? latest?.createdAt ?? p.updatedAt;
          const roundsForIdea = idea ? rounds.filter((r) => r.ideaId === idea.id).length : 0;
          if (succeeded === 0 && latest?.state === "AWAITING_DECISION") {
            waiting = { on: "anyone", what: `no candidates generated${label}`, since, link: roundLink };
          } else if (roundsForIdea >= install.maxRounds) {
            waiting = { on: "settings", what: `round ${install.maxRounds} of ${install.maxRounds} ended short${label}`, since, link: roundLink };
          } else {
            // #5a's quietest state: in no queue, nobody's turn.
            waiting = { on: "nobody", what: `${live} of ${DONE_AT} approved${label}`, since, link: roundLink };
          }
          break;
        }
      }
      return { stage, live, waiting, idea };
    };

    const overall = evaluate(undefined);
    const idea = overall.idea;
    const stage = overall.stage;
    const waiting = overall.waiting;

    const liveByTheme = new Map<string | null, number>();
    for (const img of p.images) {
      const key = img.themeId ? (themeName.get(img.themeId) ?? null) : null;
      liveByTheme.set(key, (liveByTheme.get(key) ?? 0) + 1);
    }

    const costs: { at: Date; usd: number }[] = [
      ...p.rounds.flatMap((r) => r.candidates.map((c) => ({ at: c.submittedAt ?? r.createdAt, usd: Number(c.costUsd ?? 0) }))),
      ...p.ideas.map((i) => ({ at: i.draftedAt ?? i.createdAt, usd: Number(i.draftCostUsd ?? 0) })),
    ];

    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      color: p.color,
      priority: p.priority,
      stage,
      live: p.images.length,
      liveByTheme,
      spend: { total: costs.reduce((s, c) => s + c.usd, 0), since: (d: Date) => costs.filter((c) => c.at >= d).reduce((s, c) => s + c.usd, 0) },
      waiting,
      forCampaign: (themeId) => {
        const { stage, live, waiting } = evaluate(themeId);
        return { stage, live, waiting };
      },
      dropIds: p.drops.map((d) => d.dropId),
      ideaHeadline: idea?.approvedOption?.headline ?? (idea?.approvedPrompt ? "Written in Slack" : null),
      ideaDecidedBy: idea?.state === "APPROVED" ? idea.decidedBy : null,
      ideaDecidedAt: idea?.state === "APPROVED" ? idea.decidedAt : null,
      rounds: p.rounds
        .filter((r) => !idea || r.ideaId === idea.id)
        .map((r) => ({
          number: r.number,
          candidates: r.candidates.length,
          cost: r.candidates.reduce((s, c) => s + Number(c.costUsd ?? 0), 0),
          approved: r.candidates.filter((c) => c.image && !c.image.revokedAt).length,
          state: r.state,
        }))
        .reverse(),
    };
  });

  const dropStatuses: DropStatus[] = drops.map((d) => ({
    id: d.id,
    name: d.name,
    importedAt: d.importedAt,
    state: d.state,
    themeId: d.themeId,
    productIds: d.products.map((p) => p.productId),
    waiting:
      d.state === "AWAITING_THEME" && d.summaryChannelId && d.summaryTs
        ? { on: "anyone", what: "theme question unanswered — no ideas drafted", since: d.importedAt, link: { channel: d.summaryChannelId, ts: d.summaryTs } }
        : d.state === "AWAITING_THEME"
          ? { on: "anyone", what: "theme question unanswered — no ideas drafted", since: d.importedAt, link: null }
          : null,
    lastActivityAt: d.lastProgressAt,
  }));

  return { install, products: statuses, drops: dropStatuses, themes: themeName, thresholds: thresholds(install) };
}

export type Status = Awaited<ReturnType<typeof loadStatus>>;

/** Products that belong to a drop's story: the ones it imported or brought back, not unchanged rows. */
export function dropProducts(status: Status, dropId: string) {
  const drop = status.drops.find((d) => d.id === dropId);
  const ids = new Set(drop?.productIds ?? []);
  return status.products.filter((p) => ids.has(p.id));
}

/** Each product's progress in the drop's own campaign. */
export function dropProgress(status: Status, dropId: string) {
  const drop = status.drops.find((d) => d.id === dropId);
  return dropProducts(status, dropId).map((p) => ({ product: p, ...p.forCampaign(drop?.themeId ?? null) }));
}

/** A drop is complete when every product in it is done or skipped, in its campaign (Flow 4, Step 8). */
export function dropComplete(status: Status, dropId: string) {
  const progress = dropProgress(status, dropId);
  return progress.length > 0 && progress.every((p) => p.stage === "done" || p.stage === "skipped");
}

/**
 * Stuck items across products and the drops in scope. A product can be waiting in more than one
 * campaign at once (holiday candidates while everyday is done), so each campaign's wait is listed.
 */
export function stuckItems(status: Status, scope: ProductStatus[] = status.products, drops: DropStatus[] = status.drops, now = new Date()) {
  const inScope = new Set(scope.map((p) => p.id));
  const seen = new Set<string>();
  const items: { label: string; waiting: Waiting; priority: boolean }[] = [];
  const add = (label: string, waiting: Waiting | null, priority: boolean) => {
    if (!isStuck(waiting, status.thresholds, now)) return;
    const key = `${label}|${waiting!.what}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ label, waiting: waiting!, priority });
  };
  for (const d of drops) add(d.name, d.waiting, false);
  for (const p of scope) add(p.sku, p.waiting, p.priority);
  for (const d of drops.filter((d) => d.state !== "COMPLETE")) {
    for (const { product, waiting } of dropProgress(status, d.id)) if (inScope.has(product.id)) add(product.sku, waiting, product.priority);
  }
  return items.sort((a, b) => +a.waiting.since - +b.waiting.since);
}

export function startOfMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function age(since: Date, now = new Date()) {
  const ms = now.getTime() - since.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}
