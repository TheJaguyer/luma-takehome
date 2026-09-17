// One product, one message (Flow 3, Step 1, revised). The message is a pure rendering of the
// product's current round, so every action — approve, reject, retry, revert, generate more —
// ends by re-rendering it, and no two code paths can leave it disagreeing with the database.
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { Db } from "../lib/db.js";
import { EDIT_PRICE_USD } from "../lib/luma.js";
import { DONE_AT, liveInSet } from "./imageApproval.js";
import { productTitle, usd } from "./ideaCards.js";
import { deciderLabel } from "./people.js";
import { attemptsOnSource } from "./uploads.js";

export type RoundView = {
  round: { id: string; number: number; state: "GENERATING" | "AWAITING_DECISION" | "CLOSED"; model: string; feedback: string | null; sheetFileId: string | null };
  maxRounds: number;
  product: { sku: string; name: string | null; color: string | null };
  theme: string | null; // the campaign this round is for; null = everyday
  // A name only when it is worth saying (src/core/people.ts): never a mention, because this
  // message is edited at every stage and a mention pings on every edit.
  idea: { headline: string; decidedBy: string | null; forced: boolean; forceReason: string | null; state: string };
  candidates: { id: string; position: number; state: string; error: string | null; costUsd: number; approvedBy: string | null }[];
  live: number; // live images in this round's campaign set
  // Which attempt this is *against the current source photo* (Flow 6, Step 1): a new photo
  // resets the count, because regenerating the same thing is what maxRounds exists to stop.
  // Defaults to the round number, which is the same thing until a photo is replaced.
  attempt?: number;
};

export function roundMessageBlocks(v: RoundView): KnownBlock[] {
  const title = productTitle(v.product) + (v.theme ? `  ·  🎨 ${v.theme}` : "");
  const images = (n: number) => `${n} approved ${v.theme ? `${v.theme} ` : ""}image${n === 1 ? "" : "s"}`;
  const cost = v.candidates.reduce((s, c) => s + c.costUsd, 0);
  const estimate = v.candidates.length * (EDIT_PRICE_USD[v.round.model] ?? 0);
  const attempt = v.attempt ?? v.round.number;
  const roundLine = `round ${attempt} of ${v.maxRounds}`;
  const ideaLine =
    `Idea: “${v.idea.headline}”${v.idea.decidedBy ? ` — approved by ${v.idea.decidedBy}` : ""}` +
    (v.idea.forced && v.idea.forceReason ? ` ⚠️ forced: “${v.idea.forceReason}”` : "") +
    (v.round.feedback ? `\nThis round: “${v.round.feedback}”` : "");
  const section = (text: string): KnownBlock => ({ type: "section", text: { type: "mrkdwn", text } });
  const button = (action_id: string, text: string, value: string, style?: "primary") =>
    ({ type: "button" as const, action_id, text: { type: "plain_text" as const, text }, value, ...(style ? { style } : {}) });

  if (v.round.state === "GENERATING") {
    return [section(`🔄  *${title}*\n${roundLine} — generating ${v.candidates.length} candidates · ${usd(estimate)}\n${ideaLine}`)];
  }

  const succeeded = v.candidates.filter((c) => c.state === "SUCCEEDED");
  const missing = v.candidates.length - succeeded.length;
  const done = v.live >= DONE_AT;

  // Done: the message collapses to its approved line. Every candidate stays reachable from it.
  if (done) {
    // Done is not the end of the road: another idea for the same product is one tap, and it is
    // the only thing anyone wants from here — the candidates are already in the thread.
    return [
      {
        ...section(`✅  *${title}* · done — ${images(v.live)}, live now\n“${v.idea.headline}” · ${roundLine}`),
        accessory: button("round_new_idea", "Generate another", v.round.id),
      } as KnownBlock,
    ];
  }

  // Short, and nothing queued: the system's quietest failure state (#5a) — so it says so plainly.
  if (v.round.state === "CLOSED") {
    const canMore = attempt < v.maxRounds;
    const need = DONE_AT - v.live;
    return [
      section(
        `⚠️  *${title}* has ${images(v.live)} and needs ${DONE_AT}.\n` +
          `Nothing is queued — this is waiting on a person.\n${ideaLine}`,
      ),
      {
        type: "actions",
        elements: [
          ...(canMore ? [button("round_more", `Generate ${v.candidates.length} more · ${usd(estimate)}`, v.round.id, "primary")] : []),
          button("round_new_idea", "Try a different idea", v.round.id),
        ],
      },
      ...(canMore
        ? []
        : [{ type: "context" as const, elements: [{ type: "mrkdwn" as const, text: `That was round ${attempt} of ${v.maxRounds}. Going further is a settings change, not a button (#13). ${need} more needed.` }] }]),
    ];
  }

  // Awaiting a decision.
  const approvedHere = succeeded.filter((c) => c.approvedBy);
  const progress = v.live > 0 ? `\n✅ ${v.live} approved${v.theme ? ` for ${v.theme}` : ""} · needs ${DONE_AT - v.live} more` : "";
  const header = section(`🖼  *${title}*\n${roundLine} · ${succeeded.length} of ${v.candidates.length} candidates · ${usd(cost)}\n${ideaLine}${progress}`);

  if (!v.round.sheetFileId || succeeded.length === 0) {
    const reasons = [...new Set(v.candidates.map((c) => c.error).filter(Boolean))].join("; ");
    return [
      section(`🖼  *${title}* · ${roundLine}\n${ideaLine}\n\n⚠️  None of the ${v.candidates.length} candidates generated. ${reasons}`),
      { type: "actions", elements: [button("round_retry_missing", `Retry ${missing} missing`, v.round.id, "primary"), button("round_new_idea", "Try a different idea", v.round.id)] },
    ];
  }

  return [
    header,
    { type: "image", slack_file: { id: v.round.sheetFileId }, alt_text: `${v.product.sku} candidates, numbered 1 to ${v.candidates.length}` },
    { type: "context", elements: [{ type: "mrkdwn", text: approvedHere.length ? "Tap a number to see it full size. ✅ marks approved." : "Tap a number to see it full size." }] },
    {
      type: "actions",
      elements: [
        ...succeeded.map((c) => button(`candidate_open_${c.position}`, c.approvedBy ? `✅ ${c.position}` : String(c.position), c.id)),
        button("round_reject", approvedHere.length ? "None of the rest" : "None of these", v.round.id),
        ...(missing > 0 ? [button("round_retry_missing", `Retry ${missing} missing`, v.round.id)] : []),
      ],
    },
  ];
}

export async function loadRoundView(db: Db, web: WebClient, roundId: string): Promise<RoundView & { channel: string | null; ts: string | null; ideaId: string }> {
  const round = await db.round.findUniqueOrThrow({
    where: { id: roundId },
    include: {
      product: true,
      idea: { include: { approvedOption: true, theme: true } },
      candidates: { orderBy: { position: "asc" }, include: { image: true } },
    },
  });
  const install = await db.install.findUniqueOrThrow({ where: { teamId: round.teamId } });
  const { idea } = round;
  return {
    ideaId: idea.id,
    channel: round.messageChannelId ?? idea.cardChannelId,
    ts: round.messageTs ?? idea.cardTs,
    round: { id: round.id, number: round.number, state: round.state, model: round.model, feedback: round.feedback, sheetFileId: round.sheetFileId },
    maxRounds: install.maxRounds,
    product: round.product,
    theme: idea.theme?.name ?? null,
    idea: {
      headline: idea.approvedOption ? `${idea.approvedOption.headline}${idea.edited ? " (edited)" : ""}` : idea.approvedPrompt ? "Written in Slack" : "—",
      decidedBy: await deciderLabel(db, web, round.teamId, idea.decidedBy),
      forced: idea.forced,
      forceReason: idea.forceReason,
      state: idea.state,
    },
    candidates: round.candidates.map((c) => ({
      id: c.id,
      position: c.position,
      state: c.state,
      error: c.error,
      costUsd: Number(c.costUsd ?? 0),
      approvedBy: c.image && !c.image.revokedAt ? c.image.approvedBy : null,
    })),
    live: await liveInSet(db, round.productId, idea.themeId),
    attempt: await attemptsOnSource(db, idea.id, round.sourcePhotoId, round.number),
  };
}

/** Re-renders the product's message from its latest round. */
export async function refreshProductMessage(db: Db, web: WebClient, roundId: string) {
  const anyRound = await db.round.findUniqueOrThrow({ where: { id: roundId }, select: { ideaId: true } });
  const latest = await db.round.findFirstOrThrow({ where: { ideaId: anyRound.ideaId }, orderBy: { number: "desc" } });
  const view = await loadRoundView(db, web, latest.id);
  if (!view.channel || !view.ts) return;
  // A superseded idea's message belongs to the replacement idea's card now.
  if (view.idea.state === "SUPERSEDED") return;
  await web.chat.update({
    channel: view.channel,
    ts: view.ts,
    text: `${view.product.sku}: round ${view.round.number}`,
    blocks: roundMessageBlocks(view),
  });
}
