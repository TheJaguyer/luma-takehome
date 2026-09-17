// Flow 3, Branches: "a generation fails → the message says how many came back and offers to retry
// the missing ones". Retrying re-queues only the failed candidates of the same round — same idea,
// same source photo, same round number — so it spends nothing an approval didn't already cover.
import type { WebClient } from "@slack/web-api";
import type { Db } from "../lib/db.js";
import { EDIT_PRICE_USD } from "../lib/luma.js";
import { recordEvent } from "./team.js";

export async function retryMissing(db: Db, web: WebClient, roundId: string, actor: string) {
  const round = await db.round.findUnique({ where: { id: roundId }, include: { product: true } });
  if (!round) return { retried: 0 };

  const retried = await db.$transaction(async (tx) => {
    // Claim the round, so two taps can't queue the same retry twice.
    const claimed = await tx.round.updateMany({
      where: { id: roundId, state: "AWAITING_DECISION", candidates: { some: { state: "FAILED" } } },
      // The message is kept: the round updates it again in place when the retried candidates are back.
      data: { state: "GENERATING", postedAt: null, completedAt: null },
    });
    if (claimed.count === 0) return 0;
    const { count } = await tx.candidate.updateMany({
      where: { roundId, state: "FAILED" },
      data: { state: "PENDING", lumaId: null, error: null, costUsd: null, attempts: 0, nextPollAt: new Date(), completedAt: null },
    });
    await recordEvent(tx, { teamId: round.teamId, actor, type: "round.retried", productId: round.productId, data: { roundId, candidates: count } });
    return count;
  });

  // Same message, next stage: its buttons go while the retry runs, and the full sheet returns after.
  if (retried > 0 && round.messageChannelId && round.messageTs) {
    await web.chat.update({
      channel: round.messageChannelId,
      ts: round.messageTs,
      text: `${round.product.sku}: retrying ${retried} candidates`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `🔁  *${round.product.sku}* · round ${round.number} — retrying ${retried} missing candidate${retried === 1 ? "" : "s"} (<@${actor}>). This message updates when they're back.` },
        },
      ],
    });
  }
  return { retried, estimateUsd: retried * (EDIT_PRICE_USD[round.model] ?? 0) };
}

/** Rounds that came back short and haven't been retried or decided. */
export async function roundsWithMissing(db: Db, teamId: string) {
  const rounds = await db.round.findMany({
    where: { teamId, state: "AWAITING_DECISION", rejectedAt: null, candidates: { some: { state: "FAILED" } } },
    include: { candidates: { where: { state: "FAILED" } }, product: true },
    orderBy: { createdAt: "asc" },
  });
  const candidates = rounds.reduce((n, r) => n + r.candidates.length, 0);
  const estimateUsd = rounds.reduce((sum, r) => sum + r.candidates.length * (EDIT_PRICE_USD[r.model] ?? 0), 0);
  return { rounds, candidates, estimateUsd };
}
