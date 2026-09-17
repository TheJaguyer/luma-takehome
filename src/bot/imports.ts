// Flow 1 in Slack: a CSV dropped in the review channel becomes a drop, and the summary's
// questions (campaign theme, rename, details) are answered here. The import itself runs in the
// worker (src/worker/imports.ts).
import type { App } from "@slack/bolt";
import type { View } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import { dropNameFromFilename } from "../core/dropName.js";
import { importDetailsText, importSummaryBlocks, type ImportReport } from "../core/importSummary.js";
import { queueIdeasForDrop } from "../core/ideaQueue.js";
import { recordEvent } from "../core/team.js";
import { Prisma } from "../generated/prisma/client.js";
import type { Db } from "../lib/db.js";
import { actionContext } from "./setup.js";

type Deps = { app: App; db: Db; log: Logger };

type SlackFile = { id: string; name?: string; filetype?: string };

const THEME_NAME = /^[a-z0-9][a-z0-9-]{1,29}$/;

export function registerImports({ app, db, log }: Deps) {
  // Step 1: a file drop. Only in the review channel, so the bot never comments on a spreadsheet
  // someone shares elsewhere.
  app.event("message", async ({ event, client }) => {
    const e = event as { subtype?: string; bot_id?: string; channel: string; ts: string; user?: string; team?: string; files?: SlackFile[] };
    if (e.subtype !== "file_share" || e.bot_id || !e.user || !e.files?.length) return;

    const install = await db.install.findFirst({ where: { channelId: e.channel } });
    if (!install) return;

    const csvs = e.files.filter((f) => f.filetype === "csv" || f.name?.toLowerCase().endsWith(".csv"));
    const sheets = e.files.filter((f) => ["xlsx", "xls", "numbers", "gsheet"].includes(f.filetype ?? ""));
    if (csvs.length === 0) {
      if (sheets.length) await reply(client, e, "📎  That looks like a spreadsheet, but I read CSV exports. In Google Sheets: *File → Download → Comma-separated values*, then drop that here.");
      return;
    }
    if (install.setupStage !== "COMPLETE") {
      await reply(client, e, "📎  Finish the setup questions above first, then drop the file again.");
      return;
    }

    for (const file of csvs) {
      const filename = file.name ?? "export.csv";
      try {
        const drop = await db.drop.create({
          data: {
            teamId: install.teamId,
            name: dropNameFromFilename(filename, new Date()),
            filename,
            slackFileId: file.id,
            channelId: e.channel,
            threadTs: e.ts,
            importedBy: e.user,
          },
        });
        await reply(client, e, `📥  Reading *${filename}* — checking rows and photo URLs…`);
        log.info({ drop: drop.id, filename }, "drop recorded");
      } catch (err) {
        // Slack redelivered the event: this file in this message is already a drop.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
  });

  // Step 4, decision 1.3 + 1.4: answering the campaign question starts drafting.
  app.action("drop_theme_none", async ({ ack, body, client, respond }) => {
    await ack();
    const { userId, value } = actionContext(body);
    await answerTheme({ db, client, respond }, value, null, userId);
  });

  app.action(/^drop_theme_pick_/, async ({ ack, body, client, respond }) => {
    await ack();
    const { userId, value } = actionContext(body);
    const [dropId, themeId] = value.split(":");
    await answerTheme({ db, client, respond }, dropId!, themeId!, userId);
  });

  app.action("drop_theme_new", async ({ ack, body, client }) => {
    await ack();
    const { value, triggerId } = actionContext(body);
    await client.views.open({ trigger_id: triggerId, view: newThemeModal(value) });
  });

  app.view("new_theme_modal", async ({ ack, body, view, client }) => {
    const teamId = body.team!.id;
    const actor = body.user.id;
    const name = (view.state.values.name?.value?.value ?? "").trim().toLowerCase();
    const look = (view.state.values.look?.value?.value ?? "").trim();
    const dropId = view.private_metadata;

    if (!THEME_NAME.test(name)) {
      await ack({ response_action: "errors", errors: { name: "Lowercase letters, numbers and dashes, 2–30 characters — e.g. holiday or spring-2027." } });
      return;
    }
    if (await db.theme.findUnique({ where: { teamId_name: { teamId, name } } })) {
      await ack({ response_action: "errors", errors: { name: `"${name}" already exists — pick it from the buttons instead.` } });
      return;
    }
    await ack();

    const theme = await db.theme.create({ data: { teamId, name, look, createdBy: actor } });
    await recordEvent(db, { teamId, actor, type: "theme.created", data: { name, look } });
    const answered = await answerTheme({ db, client }, dropId, theme.id, actor);
    const install = await db.install.findUnique({ where: { teamId } });
    if (install?.channelId) {
      // Flow 7, Step 4: that message is the whole integration contract for themes.
      await client.chat.postMessage({
        channel: install.channelId,
        text: `🎨  New theme "${name}" — the site can request it as \`?theme=${name}\``,
      });
    }
    if (!answered) log.warn({ dropId, theme: name }, "theme created but the drop was already answered");
  });

  // Decision 1.2: the name is derived, and one tap to fix when the filename is junk.
  app.action("drop_rename", async ({ ack, body, client }) => {
    await ack();
    const { value, triggerId } = actionContext(body);
    const drop = await db.drop.findUnique({ where: { id: value } });
    if (!drop) return;
    await client.views.open({ trigger_id: triggerId, view: renameModal(drop.id, drop.name) });
  });

  app.view("rename_drop_modal", async ({ ack, body, view, client }) => {
    const name = (view.state.values.name?.value?.value ?? "").trim();
    if (!name) {
      await ack({ response_action: "errors", errors: { name: "A drop needs a name." } });
      return;
    }
    await ack();
    const drop = await db.drop.update({ where: { id: view.private_metadata }, data: { name } });
    await recordEvent(db, { teamId: drop.teamId, actor: body.user.id, type: "drop.renamed", dropId: drop.id, data: { name } });
    await refreshSummary(db, client, drop.id);
  });

  app.action("drop_details", async ({ ack, body, client }) => {
    await ack();
    const { value } = actionContext(body);
    const drop = await db.drop.findUnique({ where: { id: value } });
    if (!drop?.report) return;
    await client.chat.postMessage({
      channel: drop.channelId,
      thread_ts: drop.threadTs,
      text: importDetailsText(drop.report as ImportReport) || "Nothing to report.",
    });
  });
}

async function answerTheme(
  { db, client, respond }: { db: Db; client: WebClient; respond?: (msg: object) => Promise<unknown> },
  dropId: string,
  themeId: string | null,
  userId: string,
) {
  // Anyone can answer (imports are not an approver action), but only once. Claiming the answer and
  // queueing the ideas it implies happen together, so an answer never exists without its ideas.
  const queued = await db.$transaction(async (tx) => {
    const claimed = await tx.drop.updateMany({
      where: { id: dropId, state: "AWAITING_THEME", themeAnsweredAt: null },
      data: { themeAnsweredAt: new Date(), themeAnsweredBy: userId, themeId, state: "DRAFTING", lastProgressAt: new Date() },
    });
    if (claimed.count === 0) return null;
    const count = await queueIdeasForDrop(tx, dropId);
    const current = await tx.drop.findUniqueOrThrow({ where: { id: dropId } });
    await tx.drop.update({
      where: { id: dropId },
      data: {
        report: { ...(current.report as ImportReport), toDraft: count },
        // Nothing to draft for this campaign: the drop has nothing left to do.
        ...(count === 0 ? { state: "COMPLETE" as const, completedAt: new Date() } : {}),
      },
    });
    return count;
  });
  const drop = await db.drop.findUnique({ where: { id: dropId }, include: { theme: true } });
  if (!drop) return false;
  if (queued === null) {
    await respond?.({
      response_type: "ephemeral",
      replace_original: false,
      text: drop.themeAnsweredBy ? `<@${drop.themeAnsweredBy}> already answered this.` : "This import isn't waiting on that question.",
    });
    return false;
  }
  await recordEvent(db, {
    teamId: drop.teamId,
    actor: userId,
    type: "drop.theme_answered",
    dropId,
    data: { theme: drop.theme?.name ?? null, ideasQueued: queued },
  });
  await refreshSummary(db, client, dropId);
  return true;
}

export async function refreshSummary(db: Db, client: WebClient, dropId: string) {
  const drop = await db.drop.findUnique({ where: { id: dropId }, include: { theme: true } });
  if (!drop?.report || !drop.summaryTs || !drop.summaryChannelId) return;
  const themes = await db.theme.findMany({ where: { teamId: drop.teamId }, orderBy: { createdAt: "desc" } });
  await client.chat.update({
    channel: drop.summaryChannelId,
    ts: drop.summaryTs,
    text: `Import complete — ${drop.name}`,
    blocks: importSummaryBlocks({ drop, report: drop.report as ImportReport, themeName: drop.theme?.name ?? null, themes }),
  });
}

function reply(client: WebClient, e: { channel: string; ts: string }, text: string) {
  return client.chat.postMessage({ channel: e.channel, thread_ts: e.ts, text });
}

function newThemeModal(dropId: string): View {
  return {
    type: "modal",
    callback_id: "new_theme_modal",
    private_metadata: dropId,
    title: { type: "plain_text", text: "New theme" },
    submit: { type: "plain_text", text: "Create and draft ideas" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "name",
        label: { type: "plain_text", text: "Name — what the site asks for" },
        hint: { type: "plain_text", text: "Short and permanent: the site requests ?theme=<name>, so it can't be renamed later." },
        element: { type: "plain_text_input", action_id: "value", placeholder: { type: "plain_text", text: "holiday" }, max_length: 30 },
      },
      {
        type: "input",
        block_id: "look",
        label: { type: "plain_text", text: "Look — what steers the drafts" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: 400,
          placeholder: { type: "plain_text", text: "evergreen, candlelight, warm wood, a little snow at the window" },
        },
      },
    ],
  };
}

function renameModal(dropId: string, current: string): View {
  return {
    type: "modal",
    callback_id: "rename_drop_modal",
    private_metadata: dropId,
    title: { type: "plain_text", text: "Rename drop" },
    submit: { type: "plain_text", text: "Rename" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "name",
        label: { type: "plain_text", text: "Name" },
        hint: { type: "plain_text", text: "What people will type in /shots status." },
        element: { type: "plain_text_input", action_id: "value", initial_value: current, max_length: 60 },
      },
    ],
  };
}
