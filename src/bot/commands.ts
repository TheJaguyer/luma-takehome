// `/shots` — one command, routed by its first word. Status (Flow 4) and ideas (Flow 2) arrive in
// later build steps; until then they say so rather than pretending.
import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import type { AllMiddlewareArgs, App, SlackCommandMiddlewareArgs } from "@slack/bolt";
import type { Logger } from "pino";
import type { Db } from "../lib/db.js";
import { houseStyleModal, startSetup } from "./setup.js";

type Deps = { app: App; db: Db; log: Logger; s3: S3Client; bucket: string; socketMode: boolean };

const HELP = [
  "*Shutter* turns shot ideas into approved product images.",
  "• Drop a CSV export from the catalogue sheet in this channel to import products.",
  "• `/shots style` — see or change the house style",
  "• `/shots setup` — start setup here, if I was invited before I could hear it",
  "• `/shots health` — check that everything I depend on is answering",
  "_Coming next: `/shots ideas`, `/shots status`, `/shots HG-002`._",
].join("\n");

export function registerCommands({ app, db, log, s3, bucket, socketMode }: Deps) {
  app.command("/shots", async (args) => {
    await args.ack();
    await route(args);
  });

  async function route({ command, respond, client }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    const [verb = "help"] = command.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    log.info({ user: command.user_id, text: command.text }, "/shots");

    switch (verb) {
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
