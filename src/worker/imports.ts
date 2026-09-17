// Flow 1, Steps 2–5: apply a dropped CSV. The bot only records the drop (state IMPORTING); this
// step does the work. It is idempotent by construction — SKUs match by key, unchanged rows are
// no-ops, and each product's outcome for this drop is written once — so a crash mid-import is
// recovered by simply running it again on the next tick.
import type { S3Client } from "@aws-sdk/client-s3";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import { changedFields, FIELD_LABELS, parseCatalogCsv, type CatalogRow } from "../core/catalogCsv.js";
import { importSummaryBlocks, type ImportReport } from "../core/importSummary.js";
import { PhotoFetchError, storeSourcePhotoFromUrl } from "../core/sourcePhotos.js";
import { recordEvent } from "../core/team.js";
import type { Db } from "../lib/db.js";

type Deps = { db: Db; s3: S3Client; bucket: string; web: WebClient; log: Logger; slackToken: string };

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const PHOTO_CONCURRENCY = 6;

export async function processImports(deps: Deps) {
  const { db, log } = deps;
  const drop = await db.drop.findFirst({ where: { state: "IMPORTING" }, orderBy: { importedAt: "asc" } });
  if (!drop) return;

  log.info({ drop: drop.id, file: drop.filename }, "import started");
  let text: string;
  try {
    text = await downloadCsv(deps, drop.slackFileId);
  } catch (err) {
    return failDrop(deps, drop, `I couldn't download the file from Slack (${(err as Error).message}).`);
  }

  const parsed = parseCatalogCsv(text);
  if (!parsed.ok) return failDrop(deps, drop, parsed.reason);

  const install = await db.install.findUniqueOrThrow({ where: { teamId: drop.teamId } });
  const earlierImports = await db.drop.count({ where: { teamId: drop.teamId, id: { not: drop.id }, state: { not: "FAILED" } } });

  const report: ImportReport = {
    rowCount: parsed.rowCount,
    created: [],
    newIdeas: [],
    unchanged: 0,
    notApplied: [],
    rejected: parsed.rejected,
    photoProblems: [],
    needsPhoto: [],
    toDraft: 0,
    houseStyleSkipped: install.houseStyleSkipped && earlierImports === 0,
  };

  const outcomes = await mapLimit(parsed.rows, PHOTO_CONCURRENCY, (row) => applyRow(deps, drop, row));
  for (const o of outcomes) {
    if (o.outcome === "CREATED") report.created.push(o.sku);
    else if (o.changes.length) report.notApplied.push({ sku: o.sku, fields: o.changes });
    else report.unchanged++;
    if (o.newIdea) report.newIdeas.push(o.sku);
    if (o.photoProblem) report.photoProblems.push({ line: o.line, sku: o.sku, reason: o.photoProblem });
    if (o.needsPhoto) report.needsPhoto.push(o.sku);
    if (o.draftIdea) report.toDraft++;
  }

  const themes = await db.theme.findMany({ where: { teamId: drop.teamId }, orderBy: { createdAt: "desc" } });
  const nextState = report.toDraft > 0 ? "AWAITING_THEME" : "COMPLETE";
  const blocks = importSummaryBlocks({
    drop: { ...drop, state: nextState },
    report,
    themeName: null,
    themes,
  });

  const message = await deps.web.chat.postMessage({
    channel: drop.channelId,
    thread_ts: drop.threadTs,
    reply_broadcast: true, // the start of the drop's story belongs in the channel, not only the thread
    text: `Import complete — ${drop.name}: ${report.created.length} new products`,
    blocks,
  });

  await db.$transaction([
    db.drop.update({
      where: { id: drop.id },
      data: {
        state: nextState,
        report,
        summaryChannelId: message.channel ?? drop.channelId,
        summaryTs: message.ts ?? null,
        completedAt: nextState === "COMPLETE" ? new Date() : null,
        lastProgressAt: new Date(),
      },
    }),
    db.event.create({
      data: {
        teamId: drop.teamId,
        actor: drop.importedBy,
        type: "drop.imported",
        dropId: drop.id,
        data: {
          rows: report.rowCount,
          created: report.created.length,
          notApplied: report.notApplied.length,
          rejected: report.rejected.length,
          photoProblems: report.photoProblems.length,
          toDraft: report.toDraft,
        },
      },
    }),
  ]);
  log.info({ drop: drop.id, created: report.created.length, toDraft: report.toDraft }, "import complete");
}

type RowOutcome = {
  sku: string;
  line: number;
  outcome: "CREATED" | "UNCHANGED" | "CHANGED_NOT_APPLIED";
  changes: string[];
  newIdea: boolean;
  draftIdea: boolean;
  photoProblem: string | null;
  needsPhoto: boolean;
};

async function applyRow(deps: Deps, drop: { id: string; teamId: string; importedBy: string }, row: CatalogRow): Promise<RowOutcome> {
  const { db } = deps;
  const existing = await db.product.findUnique({
    where: { teamId_sku: { teamId: drop.teamId, sku: row.sku } },
    include: {
      drops: { where: { dropId: drop.id } },
      _count: { select: { ideas: true } },
    },
  });

  let product: { id: string; sku: string; currentSourcePhotoId: string | null };
  let recorded: { outcome: RowOutcome["outcome"]; changes: string[]; draftIdea: boolean };
  let newIdea = false;

  const already = existing?.drops[0];
  if (existing && already) {
    // A retry of this same import: the outcome was decided on the first pass.
    product = existing;
    recorded = { outcome: already.outcome as RowOutcome["outcome"], changes: already.changes, draftIdea: already.draftIdea };
  } else if (!existing) {
    product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          teamId: drop.teamId,
          sku: row.sku,
          name: row.name,
          category: row.category,
          color: row.color,
          material: row.material,
          price: row.price,
          notes: row.notes,
          sheetShotIdea: row.shotIdea,
          photoUrl: row.photoUrl,
        },
      });
      await tx.dropProduct.create({ data: { dropId: drop.id, productId: created.id, outcome: "CREATED", draftIdea: true } });
      await recordEvent(tx, { teamId: drop.teamId, actor: drop.importedBy, type: "product.created", productId: created.id, dropId: drop.id });
      return created;
    });
    recorded = { outcome: "CREATED", changes: [], draftIdea: true };
  } else {
    // An existing product: details are never overwritten without review (#12), which v1 does not
    // have yet — so differences are recorded and reported, not applied. A new shot idea is not a
    // change to review; it goes straight to idea review.
    const changes = changedFields(existing, row).map((f) => FIELD_LABELS[f]);
    newIdea = row.shotIdea !== null && row.shotIdea !== existing.sheetShotIdea;
    // A product with no ideas yet is drafted — unless an earlier import already queued it, which
    // is what makes re-dropping the same file a no-op rather than a second campaign question.
    const alreadyQueued = await db.dropProduct.count({
      where: { productId: existing.id, draftIdea: true, drop: { state: { in: ["AWAITING_THEME", "DRAFTING"] } } },
    });
    const draftIdea = newIdea || (existing._count.ideas === 0 && alreadyQueued === 0);
    const outcome = changes.length ? "CHANGED_NOT_APPLIED" : "UNCHANGED";
    product = existing;
    await db.$transaction(async (tx) => {
      if (newIdea) await tx.product.update({ where: { id: existing.id }, data: { sheetShotIdea: row.shotIdea } });
      await tx.dropProduct.create({ data: { dropId: drop.id, productId: existing.id, outcome, draftIdea, changes } });
    });
    recorded = { outcome, changes, draftIdea };
  }

  // Source photo: only fetched when the product has none. A broken link never replaces a working
  // photo ("blanks never erase", #12); a product with no photo imports anyway, flagged (Step 5).
  let photoProblem: string | null = null;
  let hasPhoto = product.currentSourcePhotoId !== null;
  if (!hasPhoto) {
    if (!row.photoUrl) {
      photoProblem = "no photo URL in the file";
    } else {
      try {
        await storeSourcePhotoFromUrl(deps, product, row.photoUrl, drop.importedBy);
        hasPhoto = true;
      } catch (err) {
        if (!(err instanceof PhotoFetchError)) throw err;
        photoProblem = err.message;
      }
    }
  }

  return {
    sku: row.sku,
    line: row.line,
    ...recorded,
    newIdea,
    photoProblem,
    needsPhoto: !hasPhoto,
  };
}

async function downloadCsv({ web, slackToken }: Deps, fileId: string) {
  const info = await web.files.info({ file: fileId });
  const url = info.file?.url_private_download;
  if (!url) throw new Error("no download URL");
  if ((info.file?.size ?? 0) > MAX_CSV_BYTES) throw new Error("the file is larger than 5 MB");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${slackToken}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download returned ${res.status}`);
  const text = await res.text();
  // Without files:read on the token, Slack answers with its HTML login page and a 200.
  if (/^\s*<!doctype html/i.test(text)) throw new Error("Slack returned a web page instead of the file");
  return text;
}

async function failDrop(deps: Deps, drop: { id: string; teamId: string; channelId: string; threadTs: string; importedBy: string; filename: string }, reason: string) {
  await deps.web.chat.postMessage({
    channel: drop.channelId,
    thread_ts: drop.threadTs,
    text: `⚠️  I couldn't import ${drop.filename}. ${reason} Nothing was imported.`,
  });
  await deps.db.$transaction([
    deps.db.drop.update({ where: { id: drop.id }, data: { state: "FAILED", error: reason } }),
    deps.db.event.create({
      data: { teamId: drop.teamId, actor: drop.importedBy, type: "drop.failed", dropId: drop.id, data: { reason } },
    }),
  ]);
  deps.log.warn({ drop: drop.id, reason }, "import failed");
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}
