// Flow 0: the invite is the configuration. Setup asks only the two questions with no safe
// default — who decides (Step 2) and what the brand looks like (Step 3) — then posts the lookup
// URL (Step 5) and what happens next (Step 6). Moving channels and /shots approvers are deferred
// (REQUIREMENTS Part 5).
import type { App } from "@slack/bolt";
import type { KnownBlock, View } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import { activeApprovers, recordEvent } from "../core/team.js";
import type { Db } from "../lib/db.js";

type Deps = { app: App; db: Db; log: Logger; publicBaseUrl: string };

export function registerSetup({ app, db, log, publicBaseUrl }: Deps) {
  // Step 1: the bot itself joining a channel.
  app.event("member_joined_channel", async ({ event, context, client }) => {
    if (event.user !== context.botUserId) return;
    const teamId = event.team ?? context.teamId!;
    const inviter = (event as { inviter?: string }).inviter ?? null;
    await startSetup({ db, client, log }, teamId, event.channel, inviter);
  });

  // Step 2: confirm the default approver.
  app.action("setup_approver_confirm", async ({ ack, body, client, respond }) => {
    await ack();
    const { teamId, userId, channelId, messageTs } = actionContext(body);
    const install = await db.install.findUnique({ where: { teamId } });
    if (install?.setupStage !== "CONFIRM_APPROVER") return;
    const approvers = await activeApprovers(db, teamId);
    // Only the named approver (or whoever started setup) can confirm the role.
    if (!approvers.some((a) => a.userId === userId) && install.setupStartedBy !== userId) {
      await respond({ response_type: "ephemeral", replace_original: false, text: "Only the person named, or whoever invited me, can confirm this." });
      return;
    }
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: "Approver confirmed",
      blocks: approverDoneBlocks(approvers.map((a) => a.userId), userId),
    });
    await advanceToHouseStyle({ db, client }, teamId, channelId);
  });

  // Step 2: hand the role to someone else.
  app.action("setup_approver_change", async ({ ack, body, client }) => {
    await ack();
    const { channelId, messageTs, triggerId } = actionContext(body);
    await client.views.open({ trigger_id: triggerId, view: approverModal(channelId, messageTs) });
  });

  app.view("setup_approver_modal", async ({ ack, body, view, client }) => {
    const teamId = body.team!.id;
    const actor = body.user.id;
    const chosen = view.state.values.approver?.user?.selected_user;
    const { channelId, messageTs } = JSON.parse(view.private_metadata) as { channelId: string; messageTs: string };
    const problem = chosen ? await approverProblem(client, chosen, channelId) : "Choose a person.";
    if (problem) {
      await ack({ response_action: "errors", errors: { approver: problem } });
      return;
    }
    await ack();

    const install = await db.install.findUnique({ where: { teamId } });
    const current = await activeApprovers(db, teamId);
    const allowed = current.length === 0 || current.some((a) => a.userId === actor) || install?.setupStartedBy === actor;
    if (!allowed) return; // the modal is only offered during setup; this guards a stale one

    await db.$transaction(async (tx) => {
      await tx.approver.updateMany({ where: { teamId, removedAt: null }, data: { removedAt: new Date(), removedBy: actor } });
      await tx.approver.create({ data: { teamId, userId: chosen!, addedBy: actor } });
      await recordEvent(tx, { teamId, actor, type: "approver.set", data: { approver: chosen!, replaced: current.map((a) => a.userId) } });
    });
    await client.chat.update({ channel: channelId, ts: messageTs, text: "Approver set", blocks: approverDoneBlocks([chosen!], actor) });
    if (install?.setupStage === "CONFIRM_APPROVER") await advanceToHouseStyle({ db, client }, teamId, channelId);
  });

  // Step 3: the house style, in the team's own words.
  app.action("setup_style_describe", async ({ ack, body, client }) => {
    await ack();
    const { teamId, channelId, messageTs, triggerId } = actionContext(body);
    const install = await db.install.findUnique({ where: { teamId } });
    await client.views.open({ trigger_id: triggerId, view: houseStyleModal(install?.houseStyle ?? "", { channelId, messageTs }) });
  });

  app.action("setup_style_skip", async ({ ack, body, client }) => {
    await ack();
    const { teamId, userId, channelId, messageTs } = actionContext(body);
    const install = await db.install.findUnique({ where: { teamId } });
    if (install?.setupStage !== "ASK_HOUSE_STYLE") return;
    await db.install.update({ where: { teamId }, data: { houseStyleSkipped: true } });
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: "House style skipped",
      blocks: [section(`🎨  House style skipped by <@${userId}>. Ideas will draft from product data alone; \`/shots style\` sets one any time.`)],
    });
    await completeSetup({ db, client, publicBaseUrl }, teamId, channelId, userId);
  });

  app.view("house_style_modal", async ({ ack, body, view, client }) => {
    await ack();
    const teamId = body.team!.id;
    const actor = body.user.id;
    const style = view.state.values.style?.text?.value?.trim() ?? "";
    const meta = JSON.parse(view.private_metadata) as { channelId?: string; messageTs?: string };
    const install = await db.install.update({
      where: { teamId },
      data: { houseStyle: style, houseStyleSkipped: false },
    });
    await recordEvent(db, { teamId, actor, type: "house_style.set", data: { style } });

    if (install.setupStage === "ASK_HOUSE_STYLE" && meta.channelId && meta.messageTs) {
      await client.chat.update({
        channel: meta.channelId,
        ts: meta.messageTs,
        text: "House style set",
        blocks: [section(`🎨  House style, from <@${actor}>:\n> ${style}\n\`/shots style\` changes it later.`)],
      });
      await completeSetup({ db, client, publicBaseUrl }, teamId, meta.channelId, actor);
    } else if (install.channelId) {
      await client.chat.postMessage({
        channel: install.channelId,
        text: `🎨  <@${actor}> updated the house style:\n> ${style}`,
      });
    }
  });
}

/** Also reached from `/shots setup`, for a bot invited before it could hear the invite. */
export async function startSetup(
  { db, client, log }: { db: Db; client: WebClient; log: Logger },
  teamId: string,
  channelId: string,
  inviter: string | null,
) {
  const install = await db.install.findUnique({ where: { teamId } });
  if (install?.channelId === channelId) return "already"; // re-invited: settings and history persist
  if (install?.channelId) {
    // Step 8 (moving channels) is deferred: say so, rather than silently ignoring the invite.
    await client.chat.postMessage({
      channel: channelId,
      text: `👋  I already post shot reviews in <#${install.channelId}>. Moving reviews to another channel isn't available yet, so I'll stay there.`,
    });
    return "elsewhere";
  }

  const inviterIsPerson = inviter ? !(await approverProblem(client, inviter, null)) : false;
  await db.$transaction(async (tx) => {
    await tx.install.upsert({
      where: { teamId },
      create: { teamId, channelId, setupStage: "CONFIRM_APPROVER", setupStartedBy: inviter },
      update: { channelId, setupStage: "CONFIRM_APPROVER", setupStartedBy: inviter },
    });
    if (inviterIsPerson) {
      await tx.approver.create({ data: { teamId, userId: inviter!, addedBy: inviter! } });
    }
    await recordEvent(tx, { teamId, actor: inviter ?? "system", type: "setup.started", data: { channelId } });
  });

  const blocks: KnownBlock[] = inviterIsPerson
    ? [
        section(
          `👋  Thanks for the invite — I'll post shot reviews in this channel.\n\n` +
            `*Approver:* <@${inviter}>   _(you invited me, so I assumed it's you)_\n\n` +
            `The approver decides. For them it's one tap. Anyone else can still approve when they're away, ` +
            `but it's a deliberate "force approve" and it's recorded with their name.`,
        ),
        buttons([
          ["setup_approver_confirm", "That's right", "primary"],
          ["setup_approver_change", "It's someone else…"],
        ]),
      ]
    : [
        section(
          `👋  Thanks for the invite — I'll post shot reviews in this channel.\n\n` +
            `*Who decides?* The approver's pick is the decision, in one tap. Anyone else can still approve, ` +
            `but it's a deliberate "force approve", recorded with their name.`,
        ),
        buttons([["setup_approver_change", "Choose the approver…", "primary"]]),
      ];
  await client.chat.postMessage({ channel: channelId, text: "Thanks for the invite — who decides?", blocks });
  log.info({ teamId, channelId, inviter }, "setup started");
  return "started";
}

async function advanceToHouseStyle({ db, client }: { db: Db; client: WebClient }, teamId: string, channelId: string) {
  await db.install.update({ where: { teamId }, data: { setupStage: "ASK_HOUSE_STYLE" } });
  await client.chat.postMessage({
    channel: channelId,
    text: "How should styled shots look?",
    blocks: [
      section(
        `🎨  *Last thing — how should styled shots look?*\n\n` +
          `A line or two about your brand's look. It steers every shot idea I draft, so it's worth the minute. ` +
          `\`/shots style\` changes it later.\n\n_For example: "warm, lived-in, natural light, no people, minimal props, a little mess."_`,
      ),
      buttons([
        ["setup_style_describe", "Describe your look…", "primary"],
        ["setup_style_skip", "Skip for now"],
      ]),
    ],
  });
}

async function completeSetup(
  { db, client, publicBaseUrl }: { db: Db; client: WebClient; publicBaseUrl: string },
  teamId: string,
  channelId: string,
  actor: string,
) {
  const updated = await db.install.updateMany({
    where: { teamId, setupStage: { not: "COMPLETE" } },
    data: { setupStage: "COMPLETE" },
  });
  if (updated.count === 0) return;
  await recordEvent(db, { teamId, actor, type: "setup.completed" });

  const base = publicBaseUrl.replace(/\/$/, "");
  // Step 5: the web person must not have to ask anyone for this.
  await client.chat.postMessage({
    channel: channelId,
    text: `For whoever wires up the site: GET ${base}/products/{SKU}/images`,
    blocks: [
      section(
        `🔌  *For whoever wires up the site:*\n\`GET ${base}/products/{SKU}/images\`\n\n` +
          `Returns approved images in display order, primary first, each with an immutable URL and its origin ` +
          `(ai / photographer). Add \`?theme=holiday\` for a campaign's images first. Approving an image changes ` +
          `what this returns — no upload step, no dev work per product. If it's ever unreachable, show the ` +
          `product's own photo.`,
      ),
    ],
  });
  // Step 6.
  await client.chat.postMessage({
    channel: channelId,
    text: "All set. Drop a CSV export in this channel and I'll take it from there.",
    blocks: [
      section(
        `✅  *All set.* Drop a CSV export in this channel and I'll take it from there.\n\n` +
          `I'll draft shot ideas for anything without one — in your house style — you approve the ideas, ` +
          `and only then do I generate images. Nothing costs money before you approve an idea.\n\n\`/shots help\` any time.`,
      ),
    ],
  });
}

/** Flow 0, Branches: the role must be a person who can be held to a decision, in the channel. */
async function approverProblem(client: WebClient, userId: string, channelId: string | null) {
  const { user } = await client.users.info({ user: userId });
  if (!user || user.deleted) return "That person isn't in this workspace.";
  if (user.is_bot || user.id === "USLACKBOT") return "An approver has to be a person, not a bot.";
  if (user.is_restricted || user.is_ultra_restricted) return "Guests can't be approvers — they can still comment and force-approve.";
  if (channelId) {
    const members = await client.conversations.members({ channel: channelId, limit: 1000 });
    if (!members.members?.includes(userId)) return "They aren't in this channel yet — invite them first, so they can see what they're deciding.";
  }
  return null;
}

export function houseStyleModal(current: string, meta: { channelId?: string; messageTs?: string } = {}): View {
  return {
    type: "modal",
    callback_id: "house_style_modal",
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "House style" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "style",
        label: { type: "plain_text", text: "How should styled shots look?" },
        hint: { type: "plain_text", text: 'e.g. "warm, lived-in, natural light, no people, minimal props, a little mess"' },
        element: {
          type: "plain_text_input",
          action_id: "text",
          multiline: true,
          max_length: 600,
          ...(current ? { initial_value: current } : {}),
        },
      },
    ],
  };
}

function approverModal(channelId: string, messageTs: string): View {
  return {
    type: "modal",
    callback_id: "setup_approver_modal",
    private_metadata: JSON.stringify({ channelId, messageTs }),
    title: { type: "plain_text", text: "Approver" },
    submit: { type: "plain_text", text: "Make approver" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "approver",
        label: { type: "plain_text", text: "Who normally has the final say?" },
        element: { type: "users_select", action_id: "user" },
      },
    ],
  };
}

function approverDoneBlocks(approvers: string[], confirmedBy: string): KnownBlock[] {
  const who = approvers.map((u) => `<@${u}>`).join(", ");
  return [section(`👋  I'll post shot reviews in this channel.\n*Approver:* ${who} — set by <@${confirmedBy}>.`)];
}

export function actionContext(body: unknown) {
  const b = body as {
    team?: { id: string };
    user: { id: string };
    channel?: { id: string };
    container?: { channel_id?: string; message_ts?: string; thread_ts?: string };
    message?: { ts: string; thread_ts?: string };
    trigger_id: string;
    actions?: { value?: string; action_id: string }[];
  };
  return {
    teamId: b.team!.id,
    userId: b.user.id,
    channelId: b.channel?.id ?? b.container?.channel_id ?? "",
    messageTs: b.message?.ts ?? b.container?.message_ts ?? "",
    threadTs: b.message?.thread_ts ?? b.container?.thread_ts,
    triggerId: b.trigger_id,
    value: b.actions?.[0]?.value ?? "",
  };
}

export const section = (text: string): KnownBlock => ({ type: "section", text: { type: "mrkdwn", text } });

export function buttons(items: [actionId: string, label: string, style?: "primary" | "danger"][]): KnownBlock {
  return {
    type: "actions",
    elements: items.map(([action_id, text, style]) => ({
      type: "button",
      action_id,
      text: { type: "plain_text", text },
      ...(style ? { style } : {}),
    })),
  };
}

