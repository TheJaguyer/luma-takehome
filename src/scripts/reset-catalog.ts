// Clears everything an import creates so the flow can start again from a CSV drop:
// products, source photos, drops, ideas, rounds, candidates, approved images, themes, the event
// log, and their files in storage. Setup survives — the review channel, approvers and house style.
//
// Run by deploy/local.sh --reset-catalog and deploy/push.sh --reset-catalog, with bot and worker
// stopped. Refuses to run without --yes.
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";
import { createStorage } from "../lib/storage.js";

if (!process.argv.includes("--yes")) {
  console.error("This deletes every product, idea, round and approved image. Re-run with --yes.");
  process.exit(1);
}

const config = loadConfig({});
const log = createLogger("reset-catalog");
const db = createDb(config.DATABASE_URL);
const s3 = createStorage(config);

// Every prefix the app writes (src/lib/storage.ts `keys`). healthcheck/ belongs to storage-init.
const PREFIXES = ["images/", "sources/", "candidates/", "sheets/"];

try {
  const before = await db.product.count();
  // One statement, so nothing is left half-cleared. installs and approvers are not listed, and
  // nothing they reference is, so CASCADE cannot reach them.
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE events, images, candidates, rounds, idea_options, ideas, drop_products, drops, source_photos, products, themes RESTART IDENTITY CASCADE`,
  );

  let deleted = 0;
  for (const Prefix of PREFIXES) {
    let ContinuationToken: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: config.S3_BUCKET, Prefix, ContinuationToken }));
      const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (objects.length) {
        await s3.send(new DeleteObjectsCommand({ Bucket: config.S3_BUCKET, Delete: { Objects: objects, Quiet: true } }));
        deleted += objects.length;
      }
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }

  const install = await db.install.findFirst();
  log.info(
    { productsCleared: before, objectsDeleted: deleted, setupKept: install ? { channel: install.channelId, stage: install.setupStage } : null },
    "catalog reset — drop a CSV in the review channel to start again",
  );
} catch (err) {
  log.error({ err }, "reset failed");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
