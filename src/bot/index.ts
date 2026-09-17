import { App, LogLevel } from "@slack/bolt";
import { z } from "zod";
import { retryMissing, roundsWithMissing } from "../core/roundRetry.js";
import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";
import { createStorage } from "../lib/storage.js";
import { registerCandidates } from "./candidates.js";
import { registerCommands } from "./commands.js";
import { registerIdeas } from "./ideas.js";
import { registerImports } from "./imports.js";
import { registerSetup } from "./setup.js";
import { registerStatus } from "./status.js";

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

registerSetup({ app, db, log, publicBaseUrl: config.PUBLIC_BASE_URL });
registerImports({ app, db, log });
registerIdeas({ app, db, log });
registerStatus({ app, db });
registerCandidates({ app, db, log, s3, bucket: config.S3_BUCKET, publicBaseUrl: config.PUBLIC_BASE_URL });
registerCommands({ app, db, log, s3, bucket: config.S3_BUCKET, socketMode, publicBaseUrl: config.PUBLIC_BASE_URL });

app.action("round_retry_missing", async ({ ack, body, client, respond }) => {
  await ack();
  const b = body as { user: { id: string }; actions: { value: string }[] };
  const { retried } = await retryMissing(db, client, b.actions[0]!.value, b.user.id);
  if (retried === 0) await respond({ response_type: "ephemeral", replace_original: false, text: "That round is already being retried." });
});

app.action("rounds_retry_all", async ({ ack, body, client, respond }) => {
  await ack();
  const b = body as { user: { id: string }; team?: { id: string } };
  const { rounds } = await roundsWithMissing(db, b.team!.id);
  let total = 0;
  for (const round of rounds) total += (await retryMissing(db, client, round.id, b.user.id)).retried;
  await respond({ response_type: "ephemeral", replace_original: true, text: `🔁  Retrying ${total} candidates across ${rounds.length} rounds. They'll go to Luma as slots free up.` });
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
