// Flow 2, Step 4–7: deciding an idea. One rule everywhere (#1): an approver decides in one tap;
// anyone else can, with a required sentence saying why. Approval starts generation immediately —
// the idea gate is the spend gate (#3) — unless the product has no source photo.
import { Prisma } from "../generated/prisma/client.js";
import type { Db } from "../lib/db.js";
import { EDIT_PRICE_USD } from "../lib/luma.js";
import { recordEvent } from "./team.js";

export type Decision =
  | { kind: "option"; position: number }
  | { kind: "edited"; position: number | null; prompt: string } // position null = written from scratch
  | { kind: "skip" };

export type DecisionOutcome =
  | { ok: false; reason: "already_decided"; decidedBy: string | null }
  | { ok: true; state: "SKIPPED" }
  | { ok: true; state: "APPROVED"; headline: string; roundStarted: boolean; estimateUsd: number; candidates: number };

export async function decideIdea(
  db: Db,
  ideaId: string,
  decision: Decision,
  actor: { userId: string; forced: boolean; reason: string | null },
): Promise<DecisionOutcome> {
  return db.$transaction(async (tx) => {
    const idea = await tx.idea.findUniqueOrThrow({
      where: { id: ideaId },
      include: { options: { orderBy: { position: "asc" } }, product: true },
    });
    // First tap wins (Flow 2, Branches): the claim is the state check itself.
    const nextState = decision.kind === "skip" ? "SKIPPED" : "APPROVED";
    const claimed = await tx.idea.updateMany({
      where: { id: ideaId, state: "AWAITING_REVIEW" },
      data: { state: nextState, decidedBy: actor.userId, decidedAt: new Date(), forced: actor.forced, forceReason: actor.reason },
    });
    if (claimed.count === 0) return { ok: false as const, reason: "already_decided" as const, decidedBy: idea.decidedBy };

    if (decision.kind === "skip") {
      await recordEvent(tx, { teamId: idea.teamId, actor: actor.userId, type: "idea.skipped", productId: idea.productId, dropId: idea.dropId ?? undefined });
      return { ok: true as const, state: "SKIPPED" as const };
    }

    let prompt: string;
    let optionId: string | null = null;
    let headline: string;
    if (decision.kind === "option") {
      const option = idea.options.find((o) => o.position === decision.position);
      if (!option) throw new Error(`idea ${ideaId} has no option ${decision.position}`);
      prompt = option.prompt;
      optionId = option.id;
      headline = option.headline;
    } else {
      // What you type is what gets generated (decision 2.3); the original stays on its option.
      prompt = decision.prompt;
      const base = decision.position === null ? null : idea.options.find((o) => o.position === decision.position);
      optionId = base?.id ?? null;
      headline = base ? `${base.headline} (edited)` : "Written in Slack";
    }

    await tx.idea.update({
      where: { id: ideaId },
      data: { approvedOptionId: optionId, approvedPrompt: prompt, edited: decision.kind === "edited" },
    });
    await recordEvent(tx, {
      teamId: idea.teamId,
      actor: actor.userId,
      type: "idea.approved",
      productId: idea.productId,
      dropId: idea.dropId ?? undefined,
      data: { headline, edited: decision.kind === "edited", forced: actor.forced, reason: actor.reason },
    });

    const install = await tx.install.findUniqueOrThrow({ where: { teamId: idea.teamId } });
    const model = idea.model ?? install.defaultModel;
    const count = install.candidatesPerRound;
    const estimateUsd = (EDIT_PRICE_USD[model] ?? 0) * count;
    if (!idea.product.currentSourcePhotoId) {
      return { ok: true as const, state: "APPROVED" as const, headline, roundStarted: false, estimateUsd, candidates: count };
    }

    await startRound(tx, {
      teamId: idea.teamId,
      ideaId,
      productId: idea.productId,
      sourcePhotoId: idea.product.currentSourcePhotoId,
      model,
      candidates: count,
      triggeredBy: actor.userId,
      feedback: null,
    });
    return { ok: true as const, state: "APPROVED" as const, headline, roundStarted: true, estimateUsd, candidates: count };
  });
}

/** Creates the round and its PENDING candidates; the worker's reconciliation loop does the rest. */
export async function startRound(
  tx: Prisma.TransactionClient,
  r: { teamId: string; ideaId: string; productId: string; sourcePhotoId: string; model: string; candidates: number; triggeredBy: string; feedback: string | null },
) {
  const previous = await tx.round.count({ where: { ideaId: r.ideaId } });
  const round = await tx.round.create({
    data: {
      teamId: r.teamId,
      ideaId: r.ideaId,
      productId: r.productId,
      sourcePhotoId: r.sourcePhotoId,
      number: previous + 1,
      model: r.model,
      feedback: r.feedback,
      triggeredBy: r.triggeredBy,
      candidates: { create: Array.from({ length: r.candidates }, (_, i) => ({ position: i + 1, model: r.model })) },
    },
  });
  await recordEvent(tx, {
    teamId: r.teamId,
    actor: r.triggeredBy,
    type: "round.started",
    productId: r.productId,
    data: { roundId: round.id, number: round.number, model: r.model, candidates: r.candidates },
  });
  return round;
}
