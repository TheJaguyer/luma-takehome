import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";
import { createLuma } from "../lib/luma.js";
import { createSlack } from "../lib/slack.js";
import { createStorage } from "../lib/storage.js";
import {
  failInterruptedSubmissions,
  finishRounds,
  pollSubmitted,
  postReadyRounds,
  submitPending,
  type GenerationDeps,
} from "./generation.js";
import { processImports } from "./imports.js";

// Exactly one replica (compose.yaml). The reconciliation loop is the durability: every tick
// selects rows not in a terminal state and advances them, so a restart loses nothing. The tick is
// short because each step only touches rows that are due (Candidate.nextPollAt).
const config = loadConfig({
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  LUMA_AGENTS_API_KEY: z.string().min(1),
});
const log = createLogger("worker");
const db = createDb(config.DATABASE_URL);

const deps: GenerationDeps = {
  db,
  log,
  luma: createLuma(config.LUMA_AGENTS_API_KEY),
  s3: createStorage(config),
  bucket: config.S3_BUCKET,
  web: createSlack(config.SLACK_BOT_TOKEN, log),
};

const TICK_MS = 3_000;
const importDeps = { ...deps, slackToken: config.SLACK_BOT_TOKEN };
const steps = {
  processImports: () => processImports(importDeps),
  submitPending: () => submitPending(deps),
  pollSubmitted: () => pollSubmitted(deps),
  finishRounds: () => finishRounds(deps),
  postReadyRounds: () => postReadyRounds(deps),
};
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

await failInterruptedSubmissions(deps);
log.info({ tickMs: TICK_MS }, "worker started");

while (!stopping) {
  // Steps run in sequence and each catches its own failure, so one bad row cannot stall the rest.
  for (const [name, step] of Object.entries(steps)) {
    try {
      await step();
    } catch (err) {
      log.error({ err, step: name }, "step failed");
    }
  }
  await new Promise((r) => setTimeout(r, TICK_MS));
}

await db.$disconnect();
log.info("worker stopped");
