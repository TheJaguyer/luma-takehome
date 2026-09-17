import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";

// Exactly one replica (compose.yaml). The reconciliation loop is the durability: every tick
// selects candidates not in a terminal state and advances them, so a restart loses nothing.
const config = loadConfig({});
const log = createLogger("worker");
const db = createDb(config.DATABASE_URL);

const TICK_MS = 15_000;
let stopping = false;

async function tick() {
  const due = await db.candidate.count({
    where: { state: { in: ["PENDING", "SUBMITTED"] }, nextPollAt: { lte: new Date() } },
  });
  log.debug({ due }, "tick");
  // Build step 3: submit PENDING candidates to Luma, poll SUBMITTED ones, store results.
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    void db.$disconnect().then(() => process.exit(0));
  });
}

log.info({ tickMs: TICK_MS }, "worker started");
while (!stopping) {
  try {
    await tick();
  } catch (err) {
    log.error({ err }, "tick failed");
  }
  await new Promise((r) => setTimeout(r, TICK_MS));
}
