// Flow 3 in Slack. A number opens that candidate full size beside the source photo, and approving
// happens there — two taps, deliberately, because that comparison is the only fidelity check in the
// system (decision 3.1). Everything else re-renders the product's one message from state.
import type { S3Client } from "@aws-sdk/client-s3";
import type { App } from "@slack/bolt";
import type { KnownBlock, View } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import { approveCandidate, DONE_AT, generateMore, rejectRound, revokeImage, tryDifferentIdea } from "../core/imageApproval.js";
import { productTitle, usd } from "../core/ideaCards.js";
import { deciderLabel } from "../core/people.js";
import { attemptsOnSource } from "../core/uploads.js";
import { refreshProductMessage } from "../core/productMessage.js";
import { refreshUploadMessage } from "../core/uploadMessage.js";
import { activeApprovers, isApprover } from "../core/team.js";
import type { Db } from "../lib/db.js";
import { EDIT_PRICE_USD } from "../lib/luma.js";
import { uploadImage, withFreshFile } from "../lib/slack.js";
import { getObjectBytes, publicImageUrl } from "../lib/storage.js";
import { actionContext } from "./setup.js";

type Deps = { app: App; db: Db; log: Logger; s3: S3Client; bucket: string; publicBaseUrl: string };

const MORE_LIKE_APPROVED =
  "More like the approved image: keep its setting, styling, composition and light, and vary only small details.";

export function registerCandidates({ app, db, log, s3, bucket, publicBaseUrl }: Deps) {
  app.action(/^candidate_open_\d$/, async ({ ack, body, client }) => {
    await ack();
    const { value, triggerId, teamId, userId } = actionContext(body);
    const needsReason = !(await isApprover(db, teamId, userId));
    const view = await candidateModal(db, value, needsReason);
    if (view) {
      await client.views.open({ trigger_id: triggerId, view });
      return;
    }
    // Not uploaded yet (a round shown before full-size views existed). The trigger expires in
    // 3 seconds, so open a placeholder first, upload, then fill it in.
    const candidate = await db.candidate.findUnique({ where: { id: value }, include: { round: { include: { product: true } } } });
    if (!candidate?.storageKey) return;
    const opened = await client.views.open({
      trigger_id: triggerId,
      view: { type: "modal", title: { type: "plain_text", text: candidate.round.product.sku }, blocks: [{ type: "section", text: { type: "mrkdwn", text: "Loading full size…" } }] },
    });
    const bytes = await getObjectBytes(s3, bucket, candidate.storageKey);
    const slackFileId = await uploadImage(client, bytes, `${candidate.round.product.sku}-${candidate.position}.jpg`, `${candidate.round.product.sku} candidate ${candidate.position}`);
    await db.candidate.update({ where: { id: value }, data: { slackFileId } });
    const ready = await candidateModal(db, value, needsReason);
    if (ready && opened.view?.id) await withFreshFile(() => client.views.update({ view_id: opened.view!.id!, view: ready }));
  });

  app.view("candidate_modal", async ({ ack, body, view, client }) => {
    const { candidateId } = JSON.parse(view.private_metadata) as { candidateId: string };
    const approver = await isApprover(db, body.team!.id, body.user.id);
    const reason = view.state.values.reason?.value?.value?.trim() ?? null;
    if (!approver && (!reason || reason.length < 3)) {
      await ack({ response_action: "errors", errors: { reason: "Say why in a few words — it's posted with the approval." } });
      return;
    }
    await ack();
    const result = await approveCandidate({ db, s3, bucket }, candidateId, { userId: body.user.id, forced: !approver, reason: approver ? null : reason });
    const candidate = await db.candidate.findUniqueOrThrow({ where: { id: candidateId }, include: { round: true } });
    if (!result.ok) {
      const channel = candidate.round.messageChannelId;
      if (channel) {
        const text = result.reason === "already_approved" ? "That candidate is already approved." : "That candidate isn't available to approve.";
        await client.chat.postEphemeral({ channel, user: body.user.id, text });
      }
      return;
    }
    await refreshProductMessage(db, client, candidate.roundId);
    const by = await deciderLabel(db, client, body.team!.id, body.user.id);
    await bestEffort(log, "post the approval notice", () => postLiveChangeNotice(client, candidate.round, {
      kind: "approved",
      sku: result.product.sku,
      theme: result.theme,
      headline: result.headline,
      isPrimary: result.isPrimary,
      live: result.live,
      themeLive: result.themeLive,
      by,
      forced: !approver,
      reason: approver ? null : reason,
      imageId: result.image.id,
      url: publicImageUrl(publicBaseUrl, result.image.publicKey),
    }));
    log.info({ image: result.image.id, sku: result.product.sku, live: result.live, forced: !approver }, "image approved");
  });

  // Decision 3.2: rejecting is free — one tap, no reason, and it attaches to the round.
  app.action("round_reject", async ({ ack, body, client }) => {
    await ack();
    const { value, userId } = actionContext(body);
    if (await rejectRound(db, value, userId)) await refreshProductMessage(db, client, value);
  });

  // Decision 3.2: spending again is not free — say what should be different.
  app.action("round_more", async ({ ack, body, client }) => {
    await ack();
    const { value, triggerId, teamId, userId } = actionContext(body);
    const round = await db.round.findUniqueOrThrow({ where: { id: value }, include: { product: true, candidates: true } });
    const install = await db.install.findUniqueOrThrow({ where: { teamId } });
    const idea = await db.idea.findUniqueOrThrow({ where: { id: round.ideaId } });
    const live = await db.image.count({ where: { productId: round.productId, themeId: idea.themeId, revokedAt: null } });
    // Attempts against the current source photo, so a replaced photo starts the count again.
    const attempts = round.product.currentSourcePhotoId ? await attemptsOnSource(db, round.ideaId, round.product.currentSourcePhotoId) : round.number;
    await client.views.open({
      trigger_id: triggerId,
      view: generateMoreModal({
        roundId: round.id,
        title: productTitle(round.product),
        next: attempts + 1,
        maxRounds: install.maxRounds,
        count: install.candidatesPerRound,
        estimate: install.candidatesPerRound * (EDIT_PRICE_USD[round.model] ?? 0),
        offerMoreLike: live > 0,
        needsReason: !(await isApprover(db, teamId, userId)),
      }),
    });
  });

  app.view("round_more_modal", async ({ ack, body, view, client }) => {
    const { roundId } = JSON.parse(view.private_metadata) as { roundId: string };
    const values = view.state.values;
    const typed = values.feedback?.value?.value?.trim() ?? "";
    const moreLike = (values.more_like?.value?.selected_options?.length ?? 0) > 0;
    const reason = values.reason?.value?.value?.trim() ?? null;
    const approver = await isApprover(db, body.team!.id, body.user.id);
    const errors: Record<string, string> = {};
    if (!typed && !moreLike) errors.feedback = "Say what should be different — this sentence is added to the next round's prompt.";
    if (!approver && (!reason || reason.length < 3)) errors.reason = "Say why in a few words — it's posted with the round.";
    if (Object.keys(errors).length) {
      await ack({ response_action: "errors", errors });
      return;
    }
    await ack();
    const feedback = [moreLike ? MORE_LIKE_APPROVED : null, typed || null].filter(Boolean).join(" ");
    const result = await generateMore(db, roundId, feedback, { userId: body.user.id, forced: !approver, reason: approver ? null : reason });
    if (!result.ok) {
      const round = await db.round.findUniqueOrThrow({ where: { id: roundId } });
      const text = { max_rounds: "That idea has used all its rounds.", already_started: "Another round has already started.", no_photo: "This product needs a source photo first." }[result.reason];
      if (round.messageChannelId) await client.chat.postEphemeral({ channel: round.messageChannelId, user: body.user.id, text });
      return;
    }
    await refreshProductMessage(db, client, result.round.id);
  });

  // No reason needed: back to idea review, where the change gets said in the idea itself (#5a).
  app.action("round_new_idea", async ({ ack, body, client }) => {
    await ack();
    const { value, userId, channelId, messageTs } = actionContext(body);
    const result = await tryDifferentIdea(db, value, userId);
    if (!result.ok) return;
    const round = await db.round.findUniqueOrThrow({ where: { id: value }, include: { product: true } });
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `${round.product.sku}: drafting a different idea`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `💡  *${productTitle(round.product)}* — drafting a different idea (<@${userId}>). It'll appear right here for review.` } }],
    });
  });

  // #4: every live change carries a one-tap revert. Reverting is itself a live change, so it follows
  // the same rule as approving: one tap for an approver, a reason from anyone else.
  app.action("image_revert", async ({ ack, body, client }) => {
    await ack();
    const { value, userId, teamId, triggerId, channelId, messageTs } = actionContext(body);
    if (await isApprover(db, teamId, userId)) {
      await doRevert(db, client, log, value, { userId, forced: false, reason: null }, { channelId, messageTs });
      return;
    }
    const approvers = await activeApprovers(db, teamId);
    await client.views.open({ trigger_id: triggerId, view: revertModal(value, { channelId, messageTs }, approvers.map((a) => a.userId)) });
  });

  app.view("image_revert_modal", async ({ ack, body, view, client }) => {
    const reason = view.state.values.reason?.value?.value?.trim() ?? "";
    if (reason.length < 3) {
      await ack({ response_action: "errors", errors: { reason: "Say why in a few words — it's posted with the change." } });
      return;
    }
    await ack();
    const meta = JSON.parse(view.private_metadata) as { imageId: string; channelId: string; messageTs: string };
    await doRevert(db, client, log, meta.imageId, { userId: body.user.id, forced: true, reason }, meta);
  });
}

async function doRevert(
  db: Db,
  client: WebClient,
  log: Logger,
  imageId: string,
  actor: { userId: string; forced: boolean; reason: string | null },
  notice: { channelId: string; messageTs: string },
) {
  const result = await revokeImage(db, imageId, actor);
  if (!result.ok) {
    await client.chat.postEphemeral({ channel: notice.channelId, user: actor.userId, text: "That image is already reverted." });
    return;
  }
  const candidate = result.image.candidateId
    ? await db.candidate.findUnique({ where: { id: result.image.candidateId }, include: { round: true } })
    : null;
  // An uploaded photo (Flow 5) has no round: its own message is what re-renders.
  const upload = result.image.uploadId ? await db.upload.findUnique({ where: { id: result.image.uploadId } }) : null;

  // State first: the product's message must match the database even if a cosmetic Slack call
  // below fails. Each of those is best-effort and logged on its own.
  if (candidate) await refreshProductMessage(db, client, candidate.roundId);
  if (upload) await refreshUploadMessage(db, client, upload.id);

  const by = await deciderLabel(db, client, result.image.teamId, actor.userId);
  await bestEffort(log, "strike the approval notice", () =>
    client.chat.update({
      channel: notice.channelId,
      ts: notice.messageTs,
      text: "Reverted",
      blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `~This image went live~ · reverted${by ? ` by ${by}` : ""}` }] }],
    }),
  );
  const at = candidate?.round ?? upload;
  if (at) {
    await bestEffort(log, "post the revert notice", () =>
      postLiveChangeNotice(client, at, {
        kind: "reverted",
        sku: result.image.product.sku,
        theme: result.image.theme?.name ?? null,
        live: result.live,
        by,
        forced: actor.forced,
        reason: actor.reason,
      }),
    );
  }
}

export async function bestEffort(log: Logger, what: string, call: () => Promise<unknown>) {
  try {
    await call();
  } catch (err) {
    log.warn({ err: (err as Error).message, what }, "slack update failed; state is already correct");
  }
}

export type Notice =
  | {
      kind: "approved";
      sku: string;
      theme: string | null;
      headline: string;
      isPrimary: boolean;
      live: number;
      themeLive: number;
      by: string | null; // a name only when it is not the approver (src/core/people.ts)
      forced: boolean;
      reason: string | null;
      imageId: string;
      url: string;
    }
  | { kind: "reverted"; sku: string; theme: string | null; live: number; by: string | null; forced: boolean; reason: string | null };

/**
 * #4's live-change notice, in the product message's thread (approvals also sent to the channel,
 * reverts not), so its history stays attached to the product. Names which theme's set
 * changed, because "images changed" alone is alarming and vague (Flow 7, Step 6).
 */
export async function postLiveChangeNotice(client: WebClient, at: { messageChannelId: string | null; messageTs: string | null }, n: Notice) {
  if (!at.messageChannelId || !at.messageTs) return;
  const set = n.theme ? `${n.theme} images` : "live images";
  const others = n.theme ? " · defaults unchanged" : "";
  // Forced always names who: that is the whole point of the record (#1).
  const forced = n.forced && n.reason ? `\n⚠️ ${n.by ?? "Someone"} decided without an approver: “${n.reason}”` : "";
  const by = n.forced ? "" : n.by ? ` by ${n.by}` : "";
  let text: string;
  let blocks: KnownBlock[];
  if (n.kind === "approved") {
    const change = n.isPrimary ? `“${n.headline}” is now primary.` : `“${n.headline}” was added.`;
    // Done in this campaign's set: an everyday-done product finishing its holiday set is news too.
    const done = n.themeLive === DONE_AT ? `✅  *${n.sku} is done${n.theme ? ` for ${n.theme}` : ""}* — ${DONE_AT} approved ${n.theme ? `${n.theme} ` : ""}images, live now.\n` : "";
    text = `${n.sku}'s ${set} changed`;
    blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${done}🔄  *${n.sku}'s ${set} changed* — ${change}\nApproved${by} · ${n.themeLive} ${n.theme ? `${n.theme} ` : ""}image${n.themeLive === 1 ? "" : "s"} live${others} · <${n.url}|view file>${forced}`,
        },
        accessory: { type: "button", action_id: "image_revert", text: { type: "plain_text", text: "Revert" }, value: n.imageId },
      },
    ];
  } else {
    text = `${n.sku}'s ${set} changed back`;
    blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `↩️  *${n.sku}'s ${set} changed* — an image was reverted${by}. ${n.live} ${n.theme ? `${n.theme} ` : ""}image${n.live === 1 ? "" : "s"} live now.${forced}` },
      },
    ];
  }
  // Thread only, both ways. The product's own message already shows the live state in the
  // channel, so broadcasting the notice said the same thing twice to everyone.
  await client.chat.postMessage({
    channel: at.messageChannelId,
    thread_ts: at.messageTs,
    text,
    blocks,
    unfurl_links: false,
  });
}

async function candidateModal(db: Db, candidateId: string, needsReason: boolean): Promise<View | null> {
  const candidate = await db.candidate.findUnique({
    where: { id: candidateId },
    include: { image: true, round: { include: { product: true, sourcePhoto: true, candidates: { where: { state: "SUCCEEDED" }, orderBy: { position: "asc" } } } } },
  });
  if (!candidate?.slackFileId) return null;
  const { round } = candidate;
  const siblings = round.candidates;
  const approved = candidate.image && !candidate.image.revokedAt ? candidate.image : null;
  const open = round.state === "AWAITING_DECISION" && !approved;

  const blocks: KnownBlock[] = [
    { type: "image", slack_file: { id: candidate.slackFileId }, alt_text: `${round.product.sku} candidate ${candidate.position}` },
  ];
  if (round.sourcePhoto.originalUrl) {
    blocks.push(
      { type: "context", elements: [{ type: "mrkdwn", text: "Check product accuracy with the source below" }] },
      { type: "image", image_url: round.sourcePhoto.originalUrl, alt_text: `${round.product.sku} product photo` },
    );
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: approved
          ? `✅ Approved by <@${approved.approvedBy}>`
          : open
            ? `Candidate ${candidate.position} of ${round.candidates.length === siblings.length ? siblings.length : `${siblings.length} that generated`}`
            : "This round is closed.",
      },
    ],
  });
  if (open && needsReason) {
    blocks.push(
      { type: "context", elements: [{ type: "mrkdwn", text: "⚠️ You're not the approver, so this is a force-approve. It goes live immediately, and the record will show you approved it without an approver." }] },
      {
        type: "input",
        block_id: "reason",
        label: { type: "plain_text", text: "Why are you deciding this now?" },
        element: { type: "plain_text_input", action_id: "value", max_length: 300 },
      },
    );
  }

  return {
    type: "modal",
    callback_id: "candidate_modal",
    private_metadata: JSON.stringify({ candidateId: candidate.id }),
    title: { type: "plain_text", text: `${round.product.sku} · ${candidate.position} of ${round.candidates.length}`.slice(0, 24) },
    close: { type: "plain_text", text: "Back to all" },
    ...(open ? { submit: { type: "plain_text" as const, text: needsReason ? "Approve anyway" : "Approve" } } : {}),
    blocks,
  };
}

function generateMoreModal(m: { roundId: string; title: string; next: number; maxRounds: number; count: number; estimate: number; offerMoreLike: boolean; needsReason: boolean }): View {
  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `🔁  *${m.title}*\n${[m.next >= 3 ? `round ${m.next} of generation` : null, `${m.count} candidates`, usd(m.estimate)].filter(Boolean).join(" · ")}` } },
    {
      type: "input",
      block_id: "feedback",
      optional: m.offerMoreLike,
      label: { type: "plain_text", text: "What should be different this time?" },
      element: {
        type: "plain_text_input",
        action_id: "value",
        multiline: true,
        max_length: 400,
        placeholder: { type: "plain_text", text: "less styled, no props, morning light not golden hour" },
      },
    },
  ];
  if (m.offerMoreLike) {
    blocks.push({
      type: "input",
      block_id: "more_like",
      optional: true,
      label: { type: "plain_text", text: "Or" },
      element: { type: "checkboxes", action_id: "value", options: [{ text: { type: "plain_text", text: "More like the one I approved" }, value: "yes" }] },
    });
  }
  if (m.needsReason) {
    blocks.push(
      { type: "context", elements: [{ type: "mrkdwn", text: "⚠️ You're not the approver, so spending on another round is recorded as without one." }] },
      { type: "input", block_id: "reason", label: { type: "plain_text", text: "Why are you deciding this now?" }, element: { type: "plain_text_input", action_id: "value", max_length: 300 } },
    );
  }
  return {
    type: "modal",
    callback_id: "round_more_modal",
    private_metadata: JSON.stringify({ roundId: m.roundId }),
    title: { type: "plain_text", text: `Generate ${m.count} more` },
    submit: { type: "plain_text", text: `Generate · ${usd(m.estimate)}` },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

function revertModal(imageId: string, notice: { channelId: string; messageTs: string }, approvers: string[]): View {
  const who = approvers.length ? approvers.map((u) => `<@${u}>`).join(" or ") : "An approver";
  return {
    type: "modal",
    callback_id: "image_revert_modal",
    private_metadata: JSON.stringify({ imageId, ...notice }),
    title: { type: "plain_text", text: "Revert anyway?" },
    submit: { type: "plain_text", text: "Revert anyway" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `⚠️  ${who} usually decides what's live. Reverting takes this image off the product page immediately.` } },
      { type: "input", block_id: "reason", label: { type: "plain_text", text: "Why are you deciding this now?" }, element: { type: "plain_text_input", action_id: "value", max_length: 300 } },
    ],
  };
}
