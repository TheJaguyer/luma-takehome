// Flow 2 in Slack: tapping a number approves that option; [Details] shows the full scenes;
// More… holds Edit, Write my own and Skip. A non-approver gets the force-approve path from #1 —
// a required sentence saying why — for every kind of approval, including an edit.
import type { App } from "@slack/bolt";
import type { KnownBlock, View } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import { decideIdea, type Decision } from "../core/ideaApproval.js";
import { decidedCardBlocks, ideaCardBlocks } from "../core/ideaCards.js";
import { loadCardIdea } from "../core/ideaQueries.js";
import { activeApprovers, isApprover, recordEvent } from "../core/team.js";
import type { Db } from "../lib/db.js";
import { actionContext } from "./setup.js";

type Deps = { app: App; db: Db; log: Logger };

type Pending = { ideaId: string; decision: Decision; channelId: string; messageTs: string };

export function registerIdeas({ app, db, log }: Deps) {
  app.action(/^idea_pick_\d$/, async ({ ack, body, client, respond }) => {
    await ack();
    const ctx = actionContext(body);
    const position = Number((body as { actions: { action_id: string }[] }).actions[0]!.action_id.slice(-1));
    const pending: Pending = { ideaId: ctx.value, decision: { kind: "option", position }, channelId: ctx.channelId, messageTs: ctx.messageTs };

    if (await isApprover(db, ctx.teamId, ctx.userId)) {
      await applyDecision({ db, client, log, respond }, pending, { userId: ctx.userId, forced: false, reason: null });
      return;
    }
    const approvers = await activeApprovers(db, ctx.teamId);
    await client.views.open({ trigger_id: ctx.triggerId, view: forceApproveModal(pending, approvers.map((a) => a.userId)) });
  });

  app.action("idea_details", async ({ ack, body, client }) => {
    await ack();
    const { value, channelId, messageTs } = actionContext(body);
    const idea = await loadCardIdea(db, value);
    if (!idea) return;
    const text = idea.options.map((o) => `*${o.position}. ${o.headline}*\n${o.prompt}`).join("\n\n");
    await client.chat.postMessage({ channel: channelId, thread_ts: messageTs, text });
  });

  app.action("idea_more", async ({ ack, body, client, respond }) => {
    await ack();
    const ctx = actionContext(body);
    const selected = (body as { actions: { selected_option?: { value: string } }[] }).actions[0]?.selected_option?.value ?? "";
    const [verb, pos, ideaId] = selected.split(":");
    if (!ideaId) return;
    const base = { ideaId, channelId: ctx.channelId, messageTs: ctx.messageTs };

    if (verb === "skip") {
      // Skip is "not now", not a decision about spend or what customers see, so it needs no reason.
      await applyDecision({ db, client, log, respond }, { ...base, decision: { kind: "skip" } }, { userId: ctx.userId, forced: false, reason: null });
      return;
    }
    const idea = await loadCardIdea(db, ideaId);
    if (!idea) return;
    const position = verb === "edit" ? Number(pos) : null;
    const option = position === null ? null : idea.options.find((o) => o.position === position);
    const needsReason = !(await isApprover(db, ctx.teamId, ctx.userId));
    await client.views.open({
      trigger_id: ctx.triggerId,
      view: editModal({ ...base, position, sku: idea.product.sku, initial: option?.prompt ?? "", needsReason }),
    });
  });

  app.view("idea_force_modal", async ({ ack, body, view, client }) => {
    const reason = view.state.values.reason?.value?.value?.trim() ?? "";
    if (reason.length < 3) {
      await ack({ response_action: "errors", errors: { reason: "Say why in a few words — it's posted with the approval." } });
      return;
    }
    await ack();
    const pending = JSON.parse(view.private_metadata) as Pending;
    await applyDecision({ db, client, log }, pending, { userId: body.user.id, forced: true, reason });
  });

  app.view("idea_edit_modal", async ({ ack, body, view, client }) => {
    const prompt = view.state.values.scene?.value?.value?.trim() ?? "";
    const reason = view.state.values.reason?.value?.value?.trim() ?? null;
    const meta = JSON.parse(view.private_metadata) as { ideaId: string; channelId: string; messageTs: string; position: number | null };
    const approver = await isApprover(db, body.team!.id, body.user.id);
    const errors: Record<string, string> = {};
    if (prompt.length < 10) errors.scene = "Describe the scene — this text is exactly what gets generated.";
    if (!approver && (!reason || reason.length < 3)) errors.reason = "Say why in a few words — it's posted with the approval.";
    if (Object.keys(errors).length) {
      await ack({ response_action: "errors", errors });
      return;
    }
    await ack();
    await applyDecision(
      { db, client, log },
      { ideaId: meta.ideaId, channelId: meta.channelId, messageTs: meta.messageTs, decision: { kind: "edited", position: meta.position, prompt } },
      { userId: body.user.id, forced: !approver, reason: approver ? null : reason },
    );
  });

  // Skip sorts a product to the end, it doesn't remove it (#8): one tap brings the card back.
  app.action("idea_unskip", async ({ ack, body, client }) => {
    await ack();
    const { value, userId, channelId, messageTs, teamId } = actionContext(body);
    const { count } = await db.idea.updateMany({
      where: { id: value, state: "SKIPPED" },
      data: { state: "AWAITING_REVIEW", decidedBy: null, decidedAt: null },
    });
    if (count === 0) return;
    await recordEvent(db, { teamId, actor: userId, type: "idea.unskipped", data: { ideaId: value } });
    const card = await loadCardIdea(db, value);
    if (card) await client.chat.update({ channel: channelId, ts: messageTs, text: `Idea review: ${card.product.sku}`, blocks: ideaCardBlocks(card) });
  });
}

async function applyDecision(
  { db, client, log, respond }: { db: Db; client: WebClient; log: Logger; respond?: (msg: object) => Promise<unknown> },
  pending: Pending,
  actor: { userId: string; forced: boolean; reason: string | null },
) {
  const outcome = await decideIdea(db, pending.ideaId, pending.decision, actor);
  const idea = await loadCardIdea(db, pending.ideaId);
  if (!idea) return;

  if (!outcome.ok) {
    const who = outcome.decidedBy ? `<@${outcome.decidedBy}> already decided this one.` : "This idea isn't waiting on a decision.";
    if (respond) await respond({ response_type: "ephemeral", replace_original: false, text: who });
    else await client.chat.postEphemeral({ channel: pending.channelId, user: actor.userId, text: who });
    return;
  }

  const blocks: KnownBlock[] =
    outcome.state === "SKIPPED"
      ? decidedCardBlocks({ ideaId: idea.id, sku: idea.product.sku, state: "SKIPPED", userId: actor.userId, forced: false, reason: null })
      : decidedCardBlocks({
          ideaId: idea.id,
          sku: idea.product.sku,
          state: "APPROVED",
          headline: outcome.headline,
          userId: actor.userId,
          forced: actor.forced,
          reason: actor.reason,
          generation: { started: outcome.roundStarted, candidates: outcome.candidates, estimateUsd: outcome.estimateUsd },
        });
  await client.chat.update({ channel: pending.channelId, ts: pending.messageTs, text: `${idea.product.sku}: ${outcome.state.toLowerCase()}`, blocks });
  log.info({ idea: idea.id, sku: idea.product.sku, state: outcome.state, forced: actor.forced }, "idea decided");
}

function forceApproveModal(pending: Pending, approvers: string[]): View {
  const who = approvers.length ? approvers.map((u) => `<@${u}>`).join(" or ") : "An approver";
  return {
    type: "modal",
    callback_id: "idea_force_modal",
    private_metadata: JSON.stringify(pending),
    title: { type: "plain_text", text: "Approve anyway?" },
    submit: { type: "plain_text", text: "Approve anyway" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⚠️  ${who} usually decides this.\n\nYou can approve it anyway. It starts generating immediately, and the record will show you approved it without an approver.`,
        },
      },
      reasonInput(),
    ],
  };
}

function editModal(m: { ideaId: string; channelId: string; messageTs: string; position: number | null; sku: string; initial: string; needsReason: boolean }): View {
  return {
    type: "modal",
    callback_id: "idea_edit_modal",
    private_metadata: JSON.stringify({ ideaId: m.ideaId, channelId: m.channelId, messageTs: m.messageTs, position: m.position }),
    title: { type: "plain_text", text: m.position === null ? "Write my own" : `Edit idea ${m.position}` },
    submit: { type: "plain_text", text: m.needsReason ? "Save and approve anyway" : "Save and approve" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "scene",
        label: { type: "plain_text", text: `Scene for ${m.sku}` },
        hint: { type: "plain_text", text: "The product stays exactly as in its photo — describe only the scene around it." },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: 1500,
          ...(m.initial ? { initial_value: m.initial } : {}),
        },
      },
      ...(m.needsReason
        ? [
            { type: "context" as const, elements: [{ type: "mrkdwn" as const, text: "⚠️ You're not the approver, so this is a force-approve." }] },
            reasonInput(),
          ]
        : []),
    ],
  };
}

function reasonInput(): KnownBlock {
  return {
    type: "input",
    block_id: "reason",
    label: { type: "plain_text", text: "Why are you deciding this now?" },
    element: {
      type: "plain_text_input",
      action_id: "value",
      placeholder: { type: "plain_text", text: "Ellie's out until Monday and the Q4 email goes out tomorrow" },
      max_length: 300,
    },
  };
}
