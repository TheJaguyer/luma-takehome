import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { App, LogLevel } from "@slack/bolt";
import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";
import { createStorage } from "../lib/storage.js";

const config = loadConfig({
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_SIGNING_SECRET: z.string().min(1),
  // Present → Socket Mode (local, no public URL). Absent → HTTP behind Caddy (deployed).
  SLACK_APP_TOKEN: z.string().startsWith("xapp-").optional(),
  PORT: z.coerce.number().default(3000),
});
const log = createLogger("bot");
const db = createDb(config.DATABASE_URL);
const s3 = createStorage(config);
const socketMode = Boolean(config.SLACK_APP_TOKEN);

const app = new App({
  token: config.SLACK_BOT_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  ...(socketMode ? { socketMode: true, appToken: config.SLACK_APP_TOKEN } : { endpoints: "/slack/events" }),
  logLevel: LogLevel.INFO,
});

// Step 2 of the build: prove Slack, Postgres and storage all answer from inside Compose.
// Replaced by the real /shots router as the flows land.
app.command("/shots", async ({ ack, respond, command }) => {
  await ack();
  const [dbOk, storageOk] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => true, () => false),
    s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })).then(() => true, () => false),
  ]);
  log.info({ user: command.user_id, text: command.text, dbOk, storageOk }, "/shots");
  await respond({
    response_type: "ephemeral",
    text: [
      "👋  Shutter is running.",
      `     Database  ${dbOk ? "✅" : "❌"}`,
      `     Storage   ${storageOk ? "✅" : "❌"}`,
      `     Slack     ✅  (${socketMode ? "Socket Mode" : "HTTP"})`,
    ].join("\n"),
  });
});

// Buttons on the candidate message. The full-size view and approval land in build step 6; until
// then they acknowledge so Slack doesn't show the tapper an error.
app.action(/^candidate_open_\d$|^round_reject$/, async ({ ack, respond }) => {
  await ack();
  await respond({
    response_type: "ephemeral",
    replace_original: false,
    text: "Reviewing candidates isn't wired up yet (build step 6).",
  });
});

app.error(async (err) => {
  log.error({ err }, "unhandled bolt error");
});

await app.start(config.PORT);
log.info({ socketMode, port: socketMode ? undefined : config.PORT }, "bot started");

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    await app.stop();
    await db.$disconnect();
    process.exit(0);
  });
}
