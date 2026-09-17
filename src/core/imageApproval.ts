// Flow 3, Steps 3–6 and Flow 7: approving an image is publishing it.
//   approveCandidate  files the image under images/ (write-once key, provenance embedded), adds it
//                     to its theme's set in approval order, and records it — the lookup changes
//   revokeImage       un-approves: the lookup stops returning it; the bytes and URL are untouched
//   rejectRound       [None of these] — per round, never per image, and free
//   generateMore      a new round of the same idea, with the sentence saying what should change
//   tryDifferentIdea  supersedes the idea and queues a fresh draft for the same product
import { randomUUID } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { Prisma } from "../generated/prisma/client.js";
import type { Db } from "../lib/db.js";
import { getObjectBytes, keys, putObject } from "../lib/storage.js";
import { startRound } from "./ideaApproval.js";
import { aiProvenanceXmp } from "./provenance.js";
import { recordEvent } from "./team.js";

export const DONE_AT = 2; // #5a

type Actor = { userId: string; forced: boolean; reason: string | null };

/** Approved, live images counted toward a product: only those it was the source for (#10). */
export function liveImageCount(db: Db | Prisma.TransactionClient, productId: string) {
  return db.image.count({ where: { productId, revokedAt: null } });
}

/**
 * Live images in one campaign's set (null = everyday). Everything scoped to a round — its message,
 * "done", notices — counts this: holiday candidates for a product already done with everyday images
 * are still a decision waiting to be made.
 */
export function liveInSet(db: Db | Prisma.TransactionClient, productId: string, themeId: string | null) {
  return db.image.count({ where: { productId, themeId, revokedAt: null } });
}

export async function approveCandidate(deps: { db: Db; s3: S3Client; bucket: string }, candidateId: string, actor: Actor) {
  const { db, s3, bucket } = deps;
  const candidate = await db.candidate.findUniqueOrThrow({
    where: { id: candidateId },
    include: { image: true, round: { include: { product: true, idea: { include: { theme: true, approvedOption: true } } } } },
  });
  if (candidate.image && !candidate.image.revokedAt) return { ok: false as const, reason: "already_approved" as const, by: candidate.image.approvedBy };
  if (candidate.state !== "SUCCEEDED" || !candidate.storageKey) return { ok: false as const, reason: "not_available" as const, by: null };

  const { round } = candidate;
  const { product, idea } = round;
  const summary = async (image: { id: string; publicKey: string }) => {
    const [live, themeLive] = await Promise.all([
      liveImageCount(db, product.id),
      db.image.count({ where: { productId: product.id, themeId: idea.themeId, revokedAt: null } }),
    ]);
    return {
      ok: true as const,
      image,
      product,
      theme: idea.theme?.name ?? null,
      headline: idea.approvedOption?.headline ?? "Written in Slack",
      live,
      themeLive,
      isPrimary: themeLive === 1,
    };
  };

  // Approved before and reverted: reinstate that image. Its file and URL never changed (write-once),
  // so only the decision is new — who, when, and its place at the end of the display order.
  if (candidate.image?.revokedAt) {
    const reinstated = await db.$transaction(async (tx) => {
      const last = await tx.image.aggregate({ where: { productId: product.id, themeId: idea.themeId, revokedAt: null }, _max: { sortKey: true } });
      const { count } = await tx.image.updateMany({
        where: { id: candidate.image!.id, revokedAt: { not: null } },
        data: {
          revokedAt: null,
          revokedBy: null,
          approvedBy: actor.userId,
          approvedAt: new Date(),
          forced: actor.forced,
          forceReason: actor.reason,
          sortKey: (last._max.sortKey ?? 0) + 1,
        },
      });
      if (count === 0) return null;
      await recordEvent(tx, {
        teamId: round.teamId,
        actor: actor.userId,
        type: "image.approved",
        productId: product.id,
        data: { imageId: candidate.image!.id, candidateId: candidate.id, reinstated: true, forced: actor.forced, reason: actor.reason },
      });
      return tx.image.findUniqueOrThrow({ where: { id: candidate.image!.id } });
    });
    if (!reinstated) return { ok: false as const, reason: "already_approved" as const, by: null };
    return summary(reinstated);
  }
  const imageId = randomUUID().replace(/-/g, "");
  const approvedAt = new Date();
  const publicKey = keys.approvedImage(product.sku, imageId);

  // Bytes first, under a key nothing points at yet: if the database write then fails, an unused
  // object is harmless, whereas a row pointing at a missing object would break a product page.
  const original = await getObjectBytes(s3, bucket, candidate.storageKey);
  const model = candidate.model ?? round.model;
  const published = await sharp(original)
    .withXmp(aiProvenanceXmp({ sku: product.sku, model, approvedAt, imageId }))
    .jpeg({ quality: 92 })
    .toBuffer();
  await putObject(s3, bucket, publicKey, published, "image/jpeg");

  try {
    const image = await db.$transaction(async (tx) => {
      const last = await tx.image.aggregate({
        where: { productId: product.id, themeId: idea.themeId, revokedAt: null },
        _max: { sortKey: true },
      });
      const image = await tx.image.create({
        data: {
          id: imageId,
          teamId: round.teamId,
          productId: product.id,
          candidateId: candidate.id,
          themeId: idea.themeId,
          origin: "ai",
          model,
          publicKey,
          width: candidate.width ?? 0,
          height: candidate.height ?? 0,
          sortKey: (last._max.sortKey ?? 0) + 1, // approval order is display order (decision 7.1)
          approvedBy: actor.userId,
          approvedAt,
          forced: actor.forced,
          forceReason: actor.reason,
        },
      });
      await recordEvent(tx, {
        teamId: round.teamId,
        actor: actor.userId,
        type: "image.approved",
        productId: product.id,
        data: {
          imageId,
          candidateId: candidate.id,
          roundId: round.id,
          position: candidate.position,
          ideaId: idea.id,
          theme: idea.theme?.name ?? null,
          model,
          sourcePhotoId: round.sourcePhotoId,
          forced: actor.forced,
          reason: actor.reason,
        },
      });
      return image;
    });
    return summary(image);
  } catch (err) {
    // Two taps at once: the unique candidate_id means only one image exists.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false as const, reason: "already_approved" as const, by: null };
    }
    throw err;
  }
}

export async function revokeImage(db: Db, imageId: string, actor: Actor) {
  const image = await db.image.findUniqueOrThrow({ where: { id: imageId }, include: { product: true, theme: true } });
  const { count } = await db.image.updateMany({
    where: { id: imageId, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: actor.userId },
  });
  if (count === 0) return { ok: false as const, by: image.revokedBy };
  await recordEvent(db, {
    teamId: image.teamId,
    actor: actor.userId,
    type: "image.revoked",
    productId: image.productId,
    data: { imageId, forced: actor.forced, reason: actor.reason },
  });
  const live = await liveInSet(db, image.productId, image.themeId);
  return { ok: true as const, image, live };
}

export async function rejectRound(db: Db, roundId: string, userId: string) {
  const round = await db.round.findUniqueOrThrow({ where: { id: roundId } });
  const { count } = await db.round.updateMany({
    where: { id: roundId, state: "AWAITING_DECISION" },
    data: { state: "CLOSED", rejectedAt: new Date(), rejectedBy: userId },
  });
  if (count > 0) {
    await recordEvent(db, { teamId: round.teamId, actor: userId, type: "round.rejected", productId: round.productId, data: { roundId } });
  }
  return count > 0;
}

export async function generateMore(db: Db, roundId: string, feedback: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    const round = await tx.round.findUniqueOrThrow({ where: { id: roundId }, include: { product: true, idea: true } });
    const install = await tx.install.findUniqueOrThrow({ where: { teamId: round.teamId } });
    const rounds = await tx.round.count({ where: { ideaId: round.ideaId } });
    if (rounds >= install.maxRounds) return { ok: false as const, reason: "max_rounds" as const };
    const later = await tx.round.count({ where: { ideaId: round.ideaId, createdAt: { gt: round.createdAt } } });
    if (later > 0) return { ok: false as const, reason: "already_started" as const };
    if (!round.product.currentSourcePhotoId) return { ok: false as const, reason: "no_photo" as const };

    // The round this one replaces is settled: nothing more is approved from it.
    await tx.round.updateMany({ where: { id: roundId, state: "AWAITING_DECISION" }, data: { state: "CLOSED" } });
    const next = await startRound(tx, {
      teamId: round.teamId,
      ideaId: round.ideaId,
      productId: round.productId,
      sourcePhotoId: round.product.currentSourcePhotoId,
      model: round.model,
      candidates: install.candidatesPerRound,
      triggeredBy: actor.userId,
      feedback,
    });
    // Same product, same message.
    await tx.round.update({ where: { id: next.id }, data: { messageChannelId: round.messageChannelId, messageTs: round.messageTs } });
    await recordEvent(tx, {
      teamId: round.teamId,
      actor: actor.userId,
      type: "round.more_requested",
      productId: round.productId,
      data: { from: roundId, to: next.id, feedback, forced: actor.forced, reason: actor.reason },
    });
    return { ok: true as const, round: next, maxRounds: install.maxRounds };
  });
}

export async function tryDifferentIdea(db: Db, roundId: string, userId: string) {
  return db.$transaction(async (tx) => {
    const round = await tx.round.findUniqueOrThrow({ where: { id: roundId }, include: { idea: true } });
    const { idea } = round;
    const superseded = await tx.idea.updateMany({ where: { id: idea.id, state: "APPROVED" }, data: { state: "SUPERSEDED" } });
    if (superseded.count === 0) return { ok: false as const };
    await tx.round.updateMany({ where: { ideaId: idea.id, state: "AWAITING_DECISION" }, data: { state: "CLOSED" } });
    const install = await tx.install.findUniqueOrThrow({ where: { teamId: round.teamId } });
    const drop = idea.dropId ? await tx.drop.findUnique({ where: { id: idea.dropId }, include: { theme: true } }) : null;
    const next = await tx.idea.create({
      data: {
        teamId: idea.teamId,
        productId: idea.productId,
        dropId: idea.dropId,
        themeId: idea.themeId,
        mode: "DRAFT",
        rawSheetIdea: idea.rawSheetIdea,
        houseStyleUsed: install.houseStyle,
        themeLookUsed: drop?.theme?.look ?? idea.themeLookUsed,
        supersedes: idea.approvedPrompt,
        // Back to idea review in the same message.
        cardChannelId: round.messageChannelId ?? idea.cardChannelId,
        cardTs: round.messageTs ?? idea.cardTs,
      },
    });
    await recordEvent(tx, {
      teamId: idea.teamId,
      actor: userId,
      type: "idea.superseded",
      productId: idea.productId,
      dropId: idea.dropId ?? undefined,
      data: { from: idea.id, to: next.id },
    });
    return { ok: true as const, idea: next };
  });
}
