// Flows 5 and 6 — the two things a photo dropped in the channel can mean.
//
//   approveUpload         Flow 5: a finished shot becomes a live image, exactly as a generated
//                         candidate does. Different provenance, identical consequences.
//   declineUpload         the upload's "None of these" — free, one tap, and reversible by
//                         uploading again.
//   replaceSourcePhoto    Flow 6: point the product at a new source version and generate against
//                         it, because a bad input is the only reliable cause of a bad generation.
import { randomUUID } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { Prisma } from "../generated/prisma/client.js";
import type { Db } from "../lib/db.js";
import { EDIT_PRICE_USD } from "../lib/luma.js";
import { getObjectBytes, keys, putObject } from "../lib/storage.js";
import { startRound } from "./ideaApproval.js";
import { liveImageCount } from "./imageApproval.js";
import { aiProvenanceXmp, uploadedAiProvenanceXmp } from "./provenance.js";
import { recordEvent } from "./team.js";

type Actor = { userId: string; forced: boolean; reason: string | null };
type Deps = { db: Db; s3: S3Client; bucket: string };

/**
 * Flow 5, Step 2. A human shot needs no approved idea and carries no cost, but everything after
 * approval is the same: a write-once public key, a place in the display order, the live-change
 * notice, and the same revert.
 */
export async function approveUpload({ db, s3, bucket }: Deps, uploadId: string, actor: Actor) {
  const upload = await db.upload.findUniqueOrThrow({
    where: { id: uploadId },
    include: { image: true, product: true, theme: true },
  });
  if (upload.image && !upload.image.revokedAt) return { ok: false as const, reason: "already_approved" as const, by: upload.image.approvedBy };

  const { product } = upload;
  const summary = async (image: { id: string; publicKey: string }) => {
    const [live, themeLive] = await Promise.all([
      liveImageCount(db, product.id),
      db.image.count({ where: { productId: product.id, themeId: upload.themeId, revokedAt: null } }),
    ]);
    return {
      ok: true as const,
      image,
      product,
      theme: upload.theme?.name ?? null,
      headline: upload.aiGenerated ? "Uploaded photo (AI-made)" : "Uploaded photo",
      live,
      themeLive,
      isPrimary: themeLive === 1,
    };
  };

  // Reverted before: the bytes and URL never changed, so only the decision is new.
  if (upload.image?.revokedAt) {
    const reinstated = await db.$transaction(async (tx) => {
      const last = await tx.image.aggregate({ where: { productId: product.id, themeId: upload.themeId, revokedAt: null }, _max: { sortKey: true } });
      const { count } = await tx.image.updateMany({
        where: { id: upload.image!.id, revokedAt: { not: null } },
        data: { revokedAt: null, revokedBy: null, approvedBy: actor.userId, approvedAt: new Date(), forced: actor.forced, forceReason: actor.reason, sortKey: (last._max.sortKey ?? 0) + 1 },
      });
      if (count === 0) return null;
      await recordEvent(tx, {
        teamId: upload.teamId,
        actor: actor.userId,
        type: "image.approved",
        productId: product.id,
        data: { imageId: upload.image!.id, uploadId, reinstated: true, origin: "photographer", forced: actor.forced, reason: actor.reason },
      });
      return tx.image.findUniqueOrThrow({ where: { id: upload.image!.id } });
    });
    if (!reinstated) return { ok: false as const, reason: "already_approved" as const, by: null };
    return summary(reinstated);
  }

  const imageId = randomUUID().replace(/-/g, "");
  const approvedAt = new Date();
  const publicKey = keys.approvedImage(product.sku, imageId);

  // Bytes first, under a key nothing points at yet — the same order as a generated candidate.
  // #16: the AI marker is written only when the uploader said it was AI-made. Claiming a
  // photographer's work is AI is as dishonest as the reverse.
  const original = await getObjectBytes(s3, bucket, upload.storageKey);
  const pipeline = sharp(original);
  const published = await (upload.aiGenerated
    ? pipeline.withXmp(uploadedAiProvenanceXmp({ sku: product.sku, approvedAt, imageId }))
    : pipeline
  )
    .jpeg({ quality: 92 })
    .toBuffer();
  await putObject(s3, bucket, publicKey, published, "image/jpeg");

  try {
    const image = await db.$transaction(async (tx) => {
      const last = await tx.image.aggregate({ where: { productId: product.id, themeId: upload.themeId, revokedAt: null }, _max: { sortKey: true } });
      const image = await tx.image.create({
        data: {
          id: imageId,
          teamId: upload.teamId,
          productId: product.id,
          uploadId: upload.id,
          themeId: upload.themeId,
          origin: "photographer",
          aiGenerated: upload.aiGenerated,
          model: null,
          publicKey,
          width: upload.width,
          height: upload.height,
          sortKey: (last._max.sortKey ?? 0) + 1,
          approvedBy: actor.userId,
          approvedAt,
          forced: actor.forced,
          forceReason: actor.reason,
        },
      });
      await recordEvent(tx, {
        teamId: upload.teamId,
        actor: actor.userId,
        type: "image.approved",
        productId: product.id,
        data: {
          imageId,
          uploadId: upload.id,
          origin: "photographer",
          aiGenerated: upload.aiGenerated,
          uploadedBy: upload.uploadedBy,
          theme: upload.theme?.name ?? null,
          forced: actor.forced,
          reason: actor.reason,
        },
      });
      return image;
    });
    return summary(image);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false as const, reason: "already_approved" as const, by: null };
    }
    throw err;
  }
}

/** The upload's [Not this one] — free, like rejecting a round (decision 3.2). */
export async function declineUpload(db: Db, uploadId: string, userId: string) {
  const upload = await db.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const { count } = await db.upload.updateMany({
    where: { id: uploadId, declinedAt: null, image: { is: null } },
    data: { declinedAt: new Date(), declinedBy: userId },
  });
  if (count > 0) {
    await recordEvent(db, { teamId: upload.teamId, actor: userId, type: "upload.declined", productId: upload.productId, data: { uploadId } });
  }
  return count > 0;
}

export type ReplaceOutcome =
  | { ok: false; reason: "already_current" }
  | { ok: true; roundStarted: boolean; startedOver: boolean; estimateUsd: number; candidates: number; blocked: "no_idea" | "max_rounds" | null };

/**
 * Flow 6, Steps 1 and 4. The photo becomes current, and the round that was waiting runs — the
 * reason someone replaces a source is almost always that the last round came out wrong because
 * the input was wrong (#11), so replacing and generating is one intention, not two errands.
 *
 * `startOver` (decision 6.1) sends the SKU back to idea review instead: an idea written for the
 * old product may not fit the new one. Approved images stay live either way (#12).
 */
export async function replaceSourcePhoto(
  db: Db,
  args: { productId: string; sourcePhotoId: string; startOver: boolean },
  actor: Actor,
): Promise<ReplaceOutcome> {
  return db.$transaction(async (tx) => {
    const product = await tx.product.findUniqueOrThrow({ where: { id: args.productId } });
    if (product.currentSourcePhotoId === args.sourcePhotoId) return { ok: false as const, reason: "already_current" as const };
    const photo = await tx.sourcePhoto.findUniqueOrThrow({ where: { id: args.sourcePhotoId } });
    const previous = product.currentSourcePhotoId;
    await tx.product.update({ where: { id: product.id }, data: { currentSourcePhotoId: photo.id } });
    await recordEvent(tx, {
      teamId: product.teamId,
      actor: actor.userId,
      type: "source_photo.replaced",
      productId: product.id,
      data: { sourcePhotoId: photo.id, version: photo.version, from: previous, startOver: args.startOver, width: photo.width, height: photo.height, forced: actor.forced, reason: actor.reason },
    });

    const install = await tx.install.findUniqueOrThrow({ where: { teamId: product.teamId } });
    const estimateUsd = (EDIT_PRICE_USD[install.defaultModel] ?? 0) * install.candidatesPerRound;

    // The product's live idea: the one generation currently answers to.
    const idea = await tx.idea.findFirst({
      where: { productId: product.id, state: "APPROVED" },
      orderBy: { createdAt: "desc" },
      include: { rounds: { orderBy: { number: "desc" }, take: 1 }, drop: { include: { theme: true } } },
    });

    if (args.startOver) {
      // Back to idea review (Flow 2), re-drafted against the new photo and product data. Nothing
      // live changes: the old images keep serving until new ones replace them (#12).
      if (idea) {
        await tx.idea.updateMany({ where: { id: idea.id, state: "APPROVED" }, data: { state: "SUPERSEDED" } });
        await tx.round.updateMany({ where: { ideaId: idea.id, state: { not: "CLOSED" } }, data: { state: "CLOSED" } });
        const last = idea.rounds[0];
        await tx.idea.create({
          data: {
            teamId: idea.teamId,
            productId: idea.productId,
            dropId: idea.dropId,
            themeId: idea.themeId,
            mode: "DRAFT",
            rawSheetIdea: idea.rawSheetIdea,
            houseStyleUsed: install.houseStyle,
            themeLookUsed: idea.drop?.theme?.look ?? idea.themeLookUsed,
            cardChannelId: last?.messageChannelId ?? idea.cardChannelId,
            cardTs: last?.messageTs ?? idea.cardTs,
          },
        });
      }
      return { ok: true as const, roundStarted: false, startedOver: true, estimateUsd, candidates: install.candidatesPerRound, blocked: idea ? null : "no_idea" };
    }

    // #3 is absolute: no approved idea, no generation. The photo is still replaced, and the
    // product goes to idea review as normal.
    if (!idea) return { ok: true as const, roundStarted: false, startedOver: false, estimateUsd, candidates: install.candidatesPerRound, blocked: "no_idea" as const };

    const last = idea.rounds[0];
    if (last) await tx.round.updateMany({ where: { ideaId: idea.id, state: "AWAITING_DECISION" }, data: { state: "CLOSED" } });
    const next = await startRound(tx, {
      teamId: product.teamId,
      ideaId: idea.id,
      productId: product.id,
      sourcePhotoId: photo.id,
      model: idea.model ?? install.defaultModel,
      candidates: install.candidatesPerRound,
      triggeredBy: actor.userId,
      feedback: null,
    });
    // Same product, same message (Flow 3, Step 1).
    if (last?.messageTs) {
      await tx.round.update({ where: { id: next.id }, data: { messageChannelId: last.messageChannelId, messageTs: last.messageTs } });
    } else if (idea.cardTs) {
      await tx.round.update({ where: { id: next.id }, data: { messageChannelId: idea.cardChannelId, messageTs: idea.cardTs } });
    }
    return { ok: true as const, roundStarted: true, startedOver: false, estimateUsd, candidates: install.candidatesPerRound, blocked: null };
  });
}

/**
 * Max rounds (#13) counts attempts against the *current* source photo, not against the idea
 * (Flow 6, Step 1). Regenerating the same thing repeatedly is what the cap exists to stop; a
 * different source photo is not the same thing, so a product that had run out gets a fresh start.
 */
export async function attemptsOnSource(
  db: Db | Prisma.TransactionClient,
  ideaId: string,
  sourcePhotoId: string,
  upToRoundNumber?: number,
) {
  return db.round.count({
    where: { ideaId, sourcePhotoId, ...(upToRoundNumber === undefined ? {} : { number: { lte: upToRoundNumber } }) },
  });
}
