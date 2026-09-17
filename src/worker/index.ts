import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";
import { createLuma } from "../lib/luma.js";
import { createSlack } from "../lib/slack.js";
import { createStorage } from "../lib/storage.js";
import { draftPending, openDrops, postCards } from "./drafting.js";
import { failInterruptedSubmissions, finishRounds, pollSubmitted, postReadyRounds, submitPending } from "./generation.js";
import { processImports } from "./imports.js";
import { scheduleTick } from "./schedule.js";

// Exactly one replica (compose.yaml). Each loop is reconciliation: every tick selects rows not in a
// terminal state and advances them, so a restart loses nothing. Two loops run side by side so a
// batch of slow Claude drafts never delays polling Luma, and vice versa.
const config = loadConfig({
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  LUMA_AGENTS_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  // Luma's per-account cap on generations in flight; over it, submissions are rejected with a 429.
  LUMA_MAX_CONCURRENT: z.coerce.number().int().positive().default(10),
});
const log = createLogger("worker");
const db = createDb(config.DATABASE_URL);
const web = createSlack(config.SLACK_BOT_TOKEN, log);
const s3 = createStorage(config);

const generation = {
  db,
  log,
  web,
  s3,
  bucket: config.S3_BUCKET,
  luma: createLuma(config.LUMA_AGENTS_API_KEY),
  maxConcurrent: config.LUMA_MAX_CONCURRENT,
};
const drafting = { db, log, web, claude: new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) };
const imports = { db, log, web, s3, bucket: config.S3_BUCKET, slackToken: config.SLACK_BOT_TOKEN };

const TICK_MS = 3_000;
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

async function loop(name: string, steps: Record<string, () => Promise<unknown>>, tickMs = TICK_MS) {
  while (!stopping) {
    // Steps run in sequence and each catches its own failure, so one bad row cannot stall the rest.
    for (const [step, run] of Object.entries(steps)) {
      try {
        await run();
      } catch (err) {
        log.error({ err, loop: name, step }, "step failed");
      }
    }
    await new Promise((r) => setTimeout(r, tickMs));
  }
}

await failInterruptedSubmissions(generation);
log.info({ tickMs: TICK_MS }, "worker started");

await Promise.all([
  loop("ideas", {
    processImports: () => processImports(imports),
    draftPending: () => draftPending(drafting),
    openDrops: () => openDrops(drafting),
    postCards: () => postCards(drafting),
  }),
  // Drop completion, the daily post and nudges: a minute's resolution is plenty.
  loop("schedule", { scheduleTick: () => scheduleTick({ db, web, log }) }, 60_000),
  loop("generation", {
    submitPending: () => submitPending(generation),
    pollSubmitted: () => pollSubmitted(generation),
    finishRounds: () => finishRounds(generation),
    postReadyRounds: () => postReadyRounds(generation),
  }),
]);

await db.$disconnect();
log.info("worker stopped");
