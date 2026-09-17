// Two levels of undo, both run with bot and worker stopped so nothing writes mid-clear.
//
//   --catalog   everything an import creates: products, source photos, uploads, drops, ideas,
//               rounds, candidates, approved images, themes, the event log, and their files in
//               storage. **Setup survives** — the review channel, the approvers, the house style —
//               so the next CSV drop starts the flow again without answering setup twice.
//
//   --factory   the above, plus the install row and the approvers: the database is as empty as it
//               was before anyone invited the bot. This is the only way to see Flow 0 again, which
//               is why it exists — the setup questions are the one part of the product that can
//               otherwise be demonstrated exactly once per workspace.
//
// Run by deploy/local.sh and deploy/push.sh. Refuses to run without --yes.
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";
import { createStorage } from "../lib/storage.js";

const factory = process.argv.includes("--factory");

if (!process.argv.includes("--yes")) {
  console.error(
    factory
      ? "This deletes everything, including the review channel, the approvers and the house style. Re-run with --yes."
      : "This deletes every product, idea, round and approved image. Re-run with --yes.",
  );
  process.exit(1);
}

const config = loadConfig({});
const log = createLogger("reset");
const db = createDb(config.DATABASE_URL);
const s3 = createStorage(config);

// Every prefix the app writes (src/lib/storage.ts `keys`). healthcheck/ belongs to storage-init.
const PREFIXES = ["images/", "sources/", "candidates/", "sheets/", "uploads/"];

// Order is irrelevant under CASCADE, but the list is the point: nothing is cleared that is not
// named here, so a table added later is not silently swept up by a reset nobody re-read.
const CATALOG_TABLES = [
  "events",
  "images",
  "uploads",
  "candidates",
  "rounds",
  "idea_options",
  "ideas",
  "drop_products",
  "drops",
  "source_photos",
  "products",
  "themes",
];
const FACTORY_TABLES = [...CATALOG_TABLES, "approvers", "installs"];

try {
  const before = { products: await db.product.count(), installs: await db.install.count() };
  const tables = factory ? FACTORY_TABLES : CATALOG_TABLES;
  // One statement, so nothing is left half-cleared.
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);

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

  if (factory) {
    // The bot is still a member of the channel, so no invite event will fire to start Flow 0 —
    // which is exactly the case `/shots setup` exists for (Flow 0, Step 1's "invited before I
    // could hear it"). Kicking and re-inviting works too, and is the more faithful demo.
    log.info(
      { productsCleared: before.products, installsCleared: before.installs, objectsDeleted: deleted },
      "factory reset — run `/shots setup` in the channel, or kick and re-invite the bot, to start setup again",
    );
  } else {
    const install = await db.install.findFirst();
    log.info(
      { productsCleared: before.products, objectsDeleted: deleted, setupKept: install ? { channel: install.channelId, stage: install.setupStage } : null },
      "catalog reset — drop a CSV in the review channel to start again",
    );
  }
} catch (err) {
  log.error({ err }, "reset failed");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
