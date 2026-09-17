// Flow 7, Step 4: a theme is a named thing. The name is what the site requests and never changes —
// renaming would silently break a live page. The look steers drafting and can be edited; past ideas
// keep the look they were drafted under (#3b).
import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import { recordEvent } from "../core/team.js";
import type { Db } from "../lib/db.js";
import { actionContext } from "./setup.js";

export async function themesCommand(db: Db, teamId: string, publicBaseUrl: string) {
  const themes = await db.theme.findMany({
    where: { teamId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { images: { where: { revokedAt: null } } } } },
  });
  if (themes.length === 0) {
    return { text: "No themes yet. They're created from an import's theme question — pick *New theme…* there." };
  }
  const base = publicBaseUrl.replace(/\/$/, "");
  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `🎨  *Themes* — the site asks for one with \`${base}/products/{SKU}/images?theme=<name>\`` } },
    ...themes.map(
      (t): KnownBlock => ({
        type: "section",
        text: { type: "mrkdwn", text: `*${t.name}* · ${t._count.images} approved image${t._count.images === 1 ? "" : "s"}\n> ${t.look}` },
        accessory: { type: "button", action_id: "theme_edit_look", text: { type: "plain_text", text: "Edit look" }, value: t.id },
      }),
    ),
  ];
  return { text: "Themes", blocks };
}

export function registerThemes({ app, db }: { app: App; db: Db }) {
  app.action("theme_edit_look", async ({ ack, body, client }) => {
    await ack();
    const { value, triggerId } = actionContext(body);
    const theme = await db.theme.findUnique({ where: { id: value } });
    if (!theme) return;
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "theme_look_modal",
        private_metadata: theme.id,
        title: { type: "plain_text", text: `Theme: ${theme.name}`.slice(0, 24) },
        submit: { type: "plain_text", text: "Save" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: `The name *${theme.name}* stays — the site requests it. New drafts use the new look; ideas already drafted keep theirs.` }],
          },
          {
            type: "input",
            block_id: "look",
            label: { type: "plain_text", text: "Look — what steers the drafts" },
            element: { type: "plain_text_input", action_id: "value", multiline: true, max_length: 400, initial_value: theme.look },
          },
        ],
      },
    });
  });

  app.view("theme_look_modal", async ({ ack, body, view, client }) => {
    const look = view.state.values.look?.value?.value?.trim() ?? "";
    if (look.length < 3) {
      await ack({ response_action: "errors", errors: { look: "Describe the look in a few words." } });
      return;
    }
    await ack();
    const theme = await db.theme.update({ where: { id: view.private_metadata }, data: { look } });
    await recordEvent(db, { teamId: theme.teamId, actor: body.user.id, type: "theme.look_changed", data: { theme: theme.name, look } });
    const install = await db.install.findUnique({ where: { teamId: theme.teamId } });
    if (install?.channelId) {
      await client.chat.postMessage({ channel: install.channelId, text: `🎨  <@${body.user.id}> updated the *${theme.name}* look — new drafts use it:\n> ${look}` });
    }
  });
}
