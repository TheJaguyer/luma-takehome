// `/shots` — one command, routed by its first word. Status (Flow 4) and ideas (Flow 2) arrive in
// later build steps; until then they say so rather than pretending.
import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import type { AllMiddlewareArgs, App, SlackCommandMiddlewareArgs } from "@slack/bolt";
import type { Logger } from "pino";
import { buildEventsCsv, buildProductsCsv } from "../core/exportCsv.js";
import { loadStatus } from "../core/status.js";
import { recordEvent } from "../core/team.js";
import { roundsWithMissing } from "../core/roundRetry.js";
import type { Db } from "../lib/db.js";
import { houseStyleModal, startSetup } from "./setup.js";
import { dailyCommand, productStatus, SKU_PATTERN, statusCommand } from "./status.js";
import { themesCommand } from "./themes.js";

type Deps = { app: App; db: Db; log: Logger; s3: S3Client; bucket: string; socketMode: boolean; publicBaseUrl: string };

const HELP = [
  "*Shutter* turns shot ideas into approved product images.",
  "• Drop a CSV export from the catalogue sheet in this channel to import products.",
  "• `/shots style` — see or change the house style",
  "• `/shots themes` — the themes the site can ask for, and each one's look",
  "• `/shots setup` — start setup here, if I was invited before I could hear it",
  "• `/shots export` — post products.csv (status and image links) and the event log here",
  "• `/shots retry` — retry every round that came back missing candidates",
  "• `/shots health` — check that everything I depend on is answering",
  "• `/shots ideas` — what's waiting for a decision, with links (and retry any failed drafts)",
  "• `/shots priority HG-002` — put a product first in the queue (`off` to clear it)",
  "• `/shots status` — where everything stands · `/shots status q4-drop` — one drop · `/shots HG-002` — one product",
  "• `/shots daily` — post today's drop report and nudges now (they post at 9am on their own)",
].join("\n");

export function registerCommands({ app, db, log, s3, bucket, socketMode, publicBaseUrl }: Deps) {
  app.command("/shots", async (args) => {
    await args.ack();
    await route(args);
  });

  async function route({ command, respond, client }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    const [verb = "help", ...args] = command.text.trim().split(/\s+/).filter(Boolean);
    log.info({ user: command.user_id, text: command.text }, "/shots");

    // `/shots HG-002` is the product zoom level.
    if (SKU_PATTERN.test(verb)) {
      const status = await loadStatus(db, command.team_id).catch(() => null);
      if (!status) return respond({ response_type: "ephemeral", text: "I'm not set up yet — `/invite @shutter` to a channel first." });
      return productStatus(status, verb, respond);
    }

    switch (verb.toLowerCase()) {
      case "status":
        return statusCommand(db, command.team_id, args, respond);

      case "themes": {
        const { text, blocks } = await themesCommand(db, command.team_id, publicBaseUrl);
        return respond({ response_type: "ephemeral", text, ...(blocks ? { blocks } : {}) });
      }

      case "daily":
        return dailyCommand(db, client, log, command.team_id, respond);

      case "help":
        return respond({ response_type: "ephemeral", text: HELP });

      case "style": {
        const install = await db.install.findUnique({ where: { teamId: command.team_id } });
        return client.views.open({ trigger_id: command.trigger_id, view: houseStyleModal(install?.houseStyle ?? "") });
      }

      case "setup": {
        let result: string;
        try {
          result = await startSetup({ db, client, log }, command.team_id, command.channel_id, command.user_id);
        } catch (err) {
          const code = (err as { data?: { error?: string } }).data?.error;
          if (code === "not_in_channel" || code === "channel_not_found") {
            return respond({ response_type: "ephemeral", text: "Invite me first: `/invite @shutter`." });
          }
          throw err;
        }
        if (result === "already") return respond({ response_type: "ephemeral", text: "I'm already set up in this channel." });
        return;
      }

      case "ideas": {
        // Retries anything drafting gave up on, then says what is waiting.
        const retried = await db.idea.updateMany({
          where: { teamId: command.team_id, state: "DRAFT_FAILED" },
          data: { state: "DRAFTING", draftAttempts: 0, draftError: null },
        });
        const waiting = await db.idea.findMany({
          where: { teamId: command.team_id, state: "AWAITING_REVIEW", cardTs: { not: null } },
          include: { product: true, drop: true },
          orderBy: [{ product: { priority: "desc" } }, { product: { sku: "asc" } }],
        });
        const links = await Promise.all(
          waiting.slice(0, 15).map(async (i) => {
            const { permalink } = await client.chat.getPermalink({ channel: i.cardChannelId!, message_ts: i.cardTs! });
            return `• <${permalink}|${i.product.sku}${i.product.name ? ` · ${i.product.name}` : ""}>${i.product.priority ? " ⭐" : ""}`;
          }),
        );
        const lines = [
          waiting.length ? `💡  *${waiting.length} ideas waiting for a decision*` : "💡  No ideas are waiting for a decision.",
          ...links,
          waiting.length > 15 ? `…and ${waiting.length - 15} more` : null,
          retried.count ? `🔁  Retrying drafts for ${retried.count} product${retried.count === 1 ? "" : "s"} that failed before.` : null,
        ].filter(Boolean);
        return respond({ response_type: "ephemeral", text: lines.join("\n") });
      }

      case "retry": {
        // Shows what retrying would spend before doing it: re-queuing is a spend (#13).
        const { rounds, candidates, estimateUsd } = await roundsWithMissing(db, command.team_id);
        if (rounds.length === 0) return respond({ response_type: "ephemeral", text: "No rounds are missing candidates." });
        return respond({
          response_type: "ephemeral",
          text: `${rounds.length} rounds are missing candidates`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🔁  *${rounds.length} rounds are missing ${candidates} candidates:* ${rounds.map((r) => r.product.sku).join(", ")}\nRetrying sends them to Luma as slots free up — about $${estimateUsd.toFixed(2)} if all succeed.`,
              },
            },
            {
              type: "actions",
              elements: [{ type: "button", action_id: "rounds_retry_all", style: "primary", text: { type: "plain_text", text: `Retry all · $${estimateUsd.toFixed(2)}` } }],
            },
          ],
        });
      }

      case "export": {
        // Files go to the review channel: the channel is the record, and the latest export is
        // findable by anyone (#2a). Slack IDs become names so the file reads without a lookup.
        const install = await db.install.findUnique({ where: { teamId: command.team_id } });
        const channel = install?.channelId ?? command.channel_id;
        const names = new Map<string, string>();
        const nameOf = async (userId: string | null) => {
          if (!userId) return "";
          if (!names.has(userId)) {
            const { user } = await client.users.info({ user: userId }).catch(() => ({ user: undefined }));
            names.set(userId, user?.profile?.display_name || user?.real_name || user?.name || userId);
          }
          return names.get(userId)!;
        };
        const [products, events] = await Promise.all([
          buildProductsCsv(db, command.team_id, publicBaseUrl, nameOf),
          buildEventsCsv(db, command.team_id, nameOf),
        ]);
        const date = new Date().toISOString().slice(0, 10);
        await client.filesUploadV2({
          channel_id: channel,
          initial_comment:
            `📤  Export for <@${command.user_id}> — ${products.products} products · ${products.images} approved images · ${events.events} events\n` +
            "_products.csv re-imports as-is: drop it back in and only new products or ideas are picked up._",
          file_uploads: [
            { file: Buffer.from(products.csv, "utf8"), filename: `shutter-products-${date}.csv`, title: `Products · ${date}` },
            { file: Buffer.from(events.csv, "utf8"), filename: `shutter-events-${date}.csv`, title: `Event log · ${date}` },
          ],
        });
        return;
      }

      // #7: ⭐ orders the idea queue, the stuck list and drafting. Everything read it before this
      // existed; nothing could set it, so "priority first" never triggered.
      case "priority": {
        const [sku, arg] = args;
        if (!sku) return respond({ response_type: "ephemeral", text: "Which product? `/shots priority HG-002` — add `off` to clear it." });
        const product = await db.product.findUnique({ where: { teamId_sku: { teamId: command.team_id, sku: sku.toUpperCase() } } });
        if (!product) return respond({ response_type: "ephemeral", text: `I don't have ${sku.toUpperCase()}. \`/shots status\` lists what I do have.` });
        const on = arg?.toLowerCase() === "off" ? false : arg?.toLowerCase() === "on" ? true : !product.priority;
        if (on === product.priority) {
          return respond({ response_type: "ephemeral", text: `${product.sku} is already ${on ? "⭐ priority" : "not priority"}.` });
        }
        await db.product.update({ where: { id: product.id }, data: { priority: on } });
        await recordEvent(db, { teamId: command.team_id, actor: command.user_id, type: on ? "product.prioritised" : "product.deprioritised", productId: product.id });
        return respond({
          response_type: "ephemeral",
          text: on
            ? `⭐  *${product.sku}* is priority — it sorts first in the idea queue, in drafting and in the stuck list.`
            : `${product.sku} is no longer priority.`,
        });
      }

      case "health": {
        const [dbOk, storageOk] = await Promise.all([
          db.$queryRaw`SELECT 1`.then(() => true, () => false),
          s3.send(new HeadBucketCommand({ Bucket: bucket })).then(() => true, () => false),
        ]);
        return respond({
          response_type: "ephemeral",
          text: [
            "👋  Shutter is running.",
            `     Database  ${dbOk ? "✅" : "❌"}`,
            `     Storage   ${storageOk ? "✅" : "❌"}`,
            `     Slack     ✅  (${socketMode ? "Socket Mode" : "HTTP"})`,
          ].join("\n"),
        });
      }

      default:
        return respond({ response_type: "ephemeral", text: `I don't know \`${verb}\` yet.\n\n${HELP}` });
    }
  }
}
