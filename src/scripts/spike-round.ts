// Build step 3: start one real generation round for HG-002 without the flows in front of it.
//
//   docker compose run --rm worker node --import tsx src/scripts/spike-round.ts [--channel C0123]
//
// It writes exactly the rows those flows will write — install, product, source photo version,
// approved idea, round, four PENDING candidates — and stops. The running worker does the rest,
// so this exercises the real generation path, not a copy of it. Spends 4 × uni-1 edits (~$0.17).
import { parseArgs } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";
import { EDIT_PRICE_USD } from "../lib/luma.js";
import { createSlack } from "../lib/slack.js";
import { createStorage, keys, putObject } from "../lib/storage.js";

const config = loadConfig({ SLACK_BOT_TOKEN: z.string().startsWith("xoxb-") });
const log = createLogger("spike-round");
const db = createDb(config.DATABASE_URL);
const s3 = createStorage(config);
const web = createSlack(config.SLACK_BOT_TOKEN, log);
const { values: args } = parseArgs({ options: { channel: { type: "string" } } });

// The row from data/catalog.csv, and the idea Flow 2 mocks up for it.
const PRODUCT = {
  sku: "HG-002",
  name: "Stoneware Mug 12oz",
  category: "Ceramics",
  color: "Sage",
  material: "Stoneware",
  price: "$28",
  photoUrl: "https://take-home-service.lumalabs-ext.workers.dev/assets/fde/hg-002.jpg",
  sheetShotIdea: "morning kitchen counter, steam, warm light",
  notes: "El: bestseller, do this one first",
};
const IDEA = {
  headline: "Morning counter",
  prompt:
    "A sunlit oak kitchen worktop in the early morning, gentle steam rising from the mug, a " +
    "crumpled natural linen cloth and a small spill of coffee beans beside it. Low warm side " +
    "light from a window, soft shadows, shallow depth of field.",
};
const MODEL = "uni-1";
const CANDIDATES = 4;

async function reviewChannel(teamId: string) {
  if (args.channel) return args.channel;
  const existing = await db.install.findUnique({ where: { teamId } });
  if (existing?.channelId) return existing.channelId;
  const res = await web.users.conversations({ types: "public_channel,private_channel", limit: 50 });
  const channel = res.channels?.[0]?.id;
  if (!channel) throw new Error("The bot isn't in any channel. /invite @shutter somewhere, or pass --channel.");
  return channel;
}

try {
  const auth = await web.auth.test();
  const teamId = auth.team_id!;
  const channelId = await reviewChannel(teamId);
  const system = auth.user_id!; // the bot stands in for the approver until Flow 0 exists

  await db.install.upsert({
    where: { teamId },
    create: { teamId, channelId, setupStage: "COMPLETE" },
    update: { channelId },
  });

  const product = await db.product.upsert({
    where: { teamId_sku: { teamId, sku: PRODUCT.sku } },
    create: { teamId, ...PRODUCT, priority: true },
    update: {},
    include: { currentSourcePhoto: true },
  });

  let sourcePhoto = product.currentSourcePhoto;
  if (!sourcePhoto) {
    const res = await fetch(PRODUCT.photoUrl);
    if (!res.ok) throw new Error(`source photo returned ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const { width = 0, height = 0, format } = await sharp(bytes).metadata();
    const storageKey = keys.sourcePhoto(PRODUCT.sku, 1, format === "png" ? "png" : "jpg");
    const contentType = format === "png" ? "image/png" : "image/jpeg";
    await putObject(s3, config.S3_BUCKET, storageKey, bytes, contentType);
    sourcePhoto = await db.sourcePhoto.create({
      data: {
        productId: product.id,
        version: 1,
        originalUrl: PRODUCT.photoUrl,
        storageKey,
        contentType,
        width,
        height,
        createdBy: system,
      },
    });
    await db.product.update({ where: { id: product.id }, data: { currentSourcePhotoId: sourcePhoto.id } });
    log.info({ width, height, storageKey }, "source photo stored");
  }

  const round = await db.$transaction(async (tx) => {
    const idea = await tx.idea.create({
      data: {
        teamId,
        productId: product.id,
        mode: "EXPAND",
        state: "APPROVED",
        rawSheetIdea: PRODUCT.sheetShotIdea,
        options: { create: [{ position: 1, headline: IDEA.headline, prompt: IDEA.prompt }] },
      },
      include: { options: true },
    });
    await tx.idea.update({
      where: { id: idea.id },
      data: {
        approvedOptionId: idea.options[0]!.id,
        approvedPrompt: IDEA.prompt,
        decidedBy: system,
        decidedAt: new Date(),
      },
    });
    const round = await tx.round.create({
      data: {
        teamId,
        ideaId: idea.id,
        productId: product.id,
        sourcePhotoId: sourcePhoto.id,
        number: 1,
        model: MODEL,
        triggeredBy: system,
        candidates: { create: Array.from({ length: CANDIDATES }, (_, i) => ({ position: i + 1, model: MODEL })) },
      },
    });
    await tx.event.create({
      data: {
        teamId,
        actor: system,
        type: "round.started",
        productId: product.id,
        data: { roundId: round.id, candidates: CANDIDATES, model: MODEL, note: "build step 3 spike" },
      },
    });
    return round;
  });

  log.info(
    { round: round.id, channelId, estimatedUsd: (EDIT_PRICE_USD[MODEL]! * CANDIDATES).toFixed(4) },
    "round queued — follow it with: docker compose logs -f worker",
  );
} catch (err) {
  log.error({ err }, "spike failed");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
