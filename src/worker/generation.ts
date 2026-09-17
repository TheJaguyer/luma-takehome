// Flow 3, Step 1–2: the reconciliation loop for generation.
//
// Every step selects rows by state and advances them, so a restart resumes exactly where the
// database says things are. The one exception is a submission in flight (SUBMITTING): Luma has no
// idempotency key, so a crash between the POST and saving its id cannot be told apart from a
// POST that never happened. Those are failed, never resubmitted — a missing candidate costs a
// retry tap; a duplicate costs money nobody approved (#13).
import sharp from "sharp";
import type { Db } from "../lib/db.js";
import { Prisma } from "../generated/prisma/client.js";
import { buildContactSheet } from "../lib/contactSheet.js";
import { EDIT_PRICE_USD, LumaError, RETRYABLE_FAILURES, type Luma, type Source } from "../lib/luma.js";
import { buildEditPrompt } from "../lib/prompts.js";
import { uploadImage, usd, withFreshFile } from "../lib/slack.js";
import { getObjectBytes, keys, putObject } from "../lib/storage.js";
import type { S3Client } from "@aws-sdk/client-s3";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";

type Deps = { db: Db; luma: Luma; s3: S3Client; bucket: string; web: WebClient; log: Logger; maxConcurrent: number };

const FIRST_POLL_MS = 20_000; // uni-1 p50 is ~30s: earlier polls are wasted
const POLL_MS = 5_000;
const DEADLINE_MS = 10 * 60_000;
const MAX_SUBMIT_ATTEMPTS = 5; // Luma-side errors (5xx) before giving up; waiting for a slot never counts
const BUSY_WAIT_MS = 15_000;
const MAX_ASYNC_RETRIES = 1; // one resubmission for a retryable async failure

const later = (ms: number) => new Date(Date.now() + ms);

/** Run once at startup: this process is the only worker, so any SUBMITTING row is orphaned. */
export async function failInterruptedSubmissions({ db, log }: Deps) {
  const { count } = await db.candidate.updateMany({
    where: { state: "SUBMITTING" },
    data: {
      state: "FAILED",
      costUsd: 0,
      completedAt: new Date(),
      error: "Interrupted while submitting. Not resubmitted, to avoid paying for it twice.",
    },
  });
  if (count > 0) log.warn({ count }, "failed interrupted submissions");
}

/**
 * Submits only into free slots. Luma caps concurrent generations per account (10 on ours), and a
 * request over the cap is rejected — so the queue lives here, in PENDING rows, not at Luma. Oldest
 * rounds first, whole rounds together, so an early approval isn't starved by later ones.
 */
export async function submitPending(deps: Deps) {
  const { db, luma, s3, bucket, log } = deps;
  const inFlight = await db.candidate.count({ where: { state: { in: ["SUBMITTING", "SUBMITTED"] } } });
  const slots = deps.maxConcurrent - inFlight;
  if (slots <= 0) return;
  const due = await db.candidate.findMany({
    where: { state: "PENDING", nextPollAt: { lte: new Date() } },
    include: { round: { include: { idea: true, product: true, sourcePhoto: true } } },
    orderBy: [{ round: { createdAt: "asc" } }, { position: "asc" }],
    take: slots,
  });

  await Promise.all(
    due.map(async (candidate) => {
      const { round } = candidate;
      const model = candidate.model ?? round.model;
      const scene = round.idea.approvedPrompt;
      if (!scene) {
        await fail(db, candidate.id, "The idea has no approved prompt.", 0);
        return;
      }
      const prompt = buildEditPrompt(scene, round.product, round.feedback);
      const source: Source = round.sourcePhoto.originalUrl
        ? { url: round.sourcePhoto.originalUrl }
        : {
            data: (await getObjectBytes(s3, bucket, round.sourcePhoto.storageKey)).toString("base64"),
            media_type: round.sourcePhoto.contentType,
          };

      // Claimed only once the request is fully built, so nothing but the POST itself can leave a
      // row in SUBMITTING.
      const claimed = await db.candidate.updateMany({
        where: { id: candidate.id, state: "PENDING" },
        data: { state: "SUBMITTING" },
      });
      if (claimed.count === 0) return;

      try {
        const generation = await luma.editImage({ prompt, source, model });
        await db.candidate.update({
          where: { id: candidate.id },
          data: {
            state: "SUBMITTED",
            lumaId: generation.id,
            model,
            prompt,
            costUsd: new Prisma.Decimal(EDIT_PRICE_USD[model] ?? 0),
            submittedAt: new Date(),
            nextPollAt: later(FIRST_POLL_MS),
          },
        });
        log.info({ candidate: candidate.id, luma: generation.id, sku: round.product.sku }, "submitted");
      } catch (err) {
        if (err instanceof LumaError && err.status === 429) {
          // Busy, not broken: nothing was created, so wait for a slot without using an attempt.
          await db.candidate.update({
            where: { id: candidate.id },
            data: { state: "PENDING", nextPollAt: later(err.retryAfter ? err.retryAfter * 1000 : BUSY_WAIT_MS) },
          });
          log.info({ candidate: candidate.id, detail: err.detail }, "Luma busy; waiting for a slot");
        } else if (err instanceof LumaError && err.retryable && candidate.attempts + 1 < MAX_SUBMIT_ATTEMPTS) {
          // Rejected before anything was created, so going back to PENDING is safe.
          await db.candidate.update({
            where: { id: candidate.id },
            data: {
              state: "PENDING",
              attempts: { increment: 1 },
              nextPollAt: later((err.retryAfter ?? 30) * 1000),
            },
          });
          log.warn({ candidate: candidate.id, status: err.status }, "submit deferred");
        } else if (err instanceof LumaError) {
          await fail(db, candidate.id, err.detail, 0);
          log.error({ candidate: candidate.id, status: err.status, detail: err.detail }, "submit rejected");
        } else {
          // A network error or timeout: the POST may or may not have landed. Same rule as a crash.
          await fail(db, candidate.id, `Submission outcome unknown (${String(err)}). Not resubmitted.`, null);
          log.error({ candidate: candidate.id, err }, "submit outcome unknown");
        }
      }
    }),
  );
}

export async function pollSubmitted(deps: Deps) {
  const { db, luma, s3, bucket, log } = deps;
  const due = await db.candidate.findMany({
    where: { state: "SUBMITTED", nextPollAt: { lte: new Date() } },
    orderBy: { nextPollAt: "asc" },
    take: 20,
  });

  await Promise.all(
    due.map(async (candidate) => {
      if (!candidate.lumaId) return;
      let generation;
      try {
        generation = await luma.getGeneration(candidate.lumaId);
      } catch (err) {
        log.warn({ candidate: candidate.id, err: String(err) }, "poll failed; will retry");
        await db.candidate.update({ where: { id: candidate.id }, data: { nextPollAt: later(15_000) } });
        return;
      }

      if (generation.state === "completed") {
        const output = generation.output.find((o) => o.type === "image") ?? generation.output[0];
        if (!output) return fail(db, candidate.id, "Completed with no output.", 0);
        // Presigned URLs expire after an hour, so the bytes are copied into our storage now.
        // A failed copy is retried on a later poll, which also fetches a fresh URL.
        let stored;
        try {
          stored = await copyOutput(deps, output.url, candidate.roundId, candidate.position);
        } catch (err) {
          log.warn({ candidate: candidate.id, err: String(err) }, "copying output failed; will retry");
          if (isOverdue(candidate.submittedAt)) return fail(db, candidate.id, `Could not copy the output: ${String(err)}`, null);
          await db.candidate.update({ where: { id: candidate.id }, data: { nextPollAt: later(15_000) } });
          return;
        }
        const { storageKey, width, height } = stored;
        await db.candidate.update({
          where: { id: candidate.id },
          data: { state: "SUCCEEDED", storageKey, width, height, completedAt: new Date() },
        });
        const seconds = candidate.submittedAt ? (Date.now() - candidate.submittedAt.getTime()) / 1000 : null;
        log.info({ candidate: candidate.id, seconds, width, height }, "generation completed");
        return;
      }

      if (generation.state === "failed") {
        const code = generation.failure_code ?? "unknown";
        if (RETRYABLE_FAILURES.has(code) && candidate.attempts < MAX_ASYNC_RETRIES) {
          await db.candidate.update({
            where: { id: candidate.id },
            data: { state: "PENDING", lumaId: null, attempts: { increment: 1 }, nextPollAt: new Date() },
          });
          log.warn({ candidate: candidate.id, code }, "generation failed; resubmitting once");
          return;
        }
        // Refunded per the pricing guide, except budget_exhausted, which may be partly charged.
        const refunded = code !== "budget_exhausted";
        await fail(db, candidate.id, `${code}: ${generation.failure_reason ?? ""}`.trim(), refunded ? 0 : null);
        log.warn({ candidate: candidate.id, code, reason: generation.failure_reason }, "generation failed");
        return;
      }

      if (isOverdue(candidate.submittedAt)) {
        await fail(db, candidate.id, `Still ${generation.state} after 10 minutes.`, null);
        return;
      }
      await db.candidate.update({ where: { id: candidate.id }, data: { nextPollAt: later(POLL_MS) } });
    }),
  );
}

const isOverdue = (submittedAt: Date | null) =>
  submittedAt !== null && Date.now() - submittedAt.getTime() > DEADLINE_MS;

async function copyOutput({ s3, bucket }: Deps, url: string, roundId: string, position: number) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download returned ${res.status}`);
  const image = sharp(Buffer.from(await res.arrayBuffer()));
  const { width, height } = await image.metadata();
  const storageKey = keys.candidate(roundId, position);
  await putObject(s3, bucket, storageKey, await image.jpeg({ quality: 92 }).toBuffer(), "image/jpeg");
  return { storageKey, width, height };
}

async function fail(db: Db, id: string, error: string, costUsd: number | null) {
  await db.candidate.update({
    where: { id },
    data: {
      state: "FAILED",
      error,
      completedAt: new Date(),
      ...(costUsd === null ? {} : { costUsd: new Prisma.Decimal(costUsd) }),
    },
  });
}

/** A round whose candidates have all reached a terminal state gets its contact sheet. */
export async function finishRounds(deps: Deps) {
  const { db, s3, bucket, log } = deps;
  const rounds = await db.round.findMany({
    where: {
      state: "GENERATING",
      candidates: { none: { state: { in: ["PENDING", "SUBMITTING", "SUBMITTED"] } } },
    },
    include: { candidates: { orderBy: { position: "asc" } } },
    take: 5,
  });

  for (const round of rounds) {
    const tiles = await Promise.all(
      round.candidates.map(async (c) => ({
        position: c.position,
        image: c.state === "SUCCEEDED" && c.storageKey ? await getObjectBytes(s3, bucket, c.storageKey) : null,
      })),
    );
    let contactSheetKey: string | null = null;
    if (tiles.some((t) => t.image)) {
      contactSheetKey = keys.contactSheet(round.id);
      await putObject(s3, bucket, contactSheetKey, await buildContactSheet(tiles), "image/jpeg");
    }
    await db.$transaction([
      db.round.update({
        where: { id: round.id },
        data: { state: "AWAITING_DECISION", contactSheetKey, completedAt: new Date() },
      }),
      db.event.create({
        data: {
          teamId: round.teamId,
          actor: "system",
          type: "round.generated",
          productId: round.productId,
          data: {
            roundId: round.id,
            succeeded: round.candidates.filter((c) => c.state === "SUCCEEDED").length,
            failed: round.candidates.filter((c) => c.state === "FAILED").length,
          },
        },
      }),
    ]);
    log.info({ round: round.id }, "round ready for review");
  }
}

/**
 * Shows rounds whose candidates are back. One product is one message (Flow 3, Step 1, revised):
 * the round replaces its idea card in place — or its own earlier message, after a retry — and only
 * a round with neither gets a new message. Kept apart from finishRounds so a Slack outage delays
 * the update rather than losing it.
 */
export async function postReadyRounds(deps: Deps) {
  const { db, s3, bucket, web, log } = deps;
  const rounds = await db.round.findMany({
    where: { state: "AWAITING_DECISION", postedAt: null },
    include: {
      candidates: { orderBy: { position: "asc" } },
      product: true,
      idea: { include: { approvedOption: true } },
    },
    take: 5,
  });

  for (const round of rounds) {
    const install = await db.install.findUnique({ where: { teamId: round.teamId } });
    if (!install?.channelId) {
      log.warn({ round: round.id }, "no review channel; cannot post round");
      continue;
    }

    const { product, idea } = round;
    const succeeded = round.candidates.filter((c) => c.state === "SUCCEEDED");
    const missing = round.candidates.length - succeeded.length;
    const cost = round.candidates.reduce((sum, c) => sum + Number(c.costUsd ?? 0), 0);
    const title = [product.sku, product.name, product.color].filter(Boolean).join(" · ");
    const ideaName = idea.approvedOption?.headline ?? idea.approvedPrompt?.slice(0, 60) ?? "—";
    const summary =
      `🖼  *${title}*\n` +
      `round ${round.number} of ${install.maxRounds} · ${succeeded.length} of ${round.candidates.length} candidates · ${usd(cost)}\n` +
      `Idea: "${ideaName}"${idea.decidedBy ? ` — approved by <@${idea.decidedBy}>` : ""}`;

    let blocks;
    if (round.contactSheetKey) {
      const sheet = await getObjectBytes(s3, bucket, round.contactSheetKey);
      const fileId = await uploadImage(web, sheet, `${product.sku}-round-${round.number}.jpg`, `${product.sku} round ${round.number}`);
      blocks = [
        { type: "section", text: { type: "mrkdwn", text: summary } },
        { type: "image", slack_file: { id: fileId }, alt_text: `${product.sku} candidates, numbered 1 to 4` },
        { type: "context", elements: [{ type: "mrkdwn", text: "Tap a number to see it full size." }] },
        {
          type: "actions",
          elements: [
            ...succeeded.map((c) => ({
              type: "button",
              action_id: `candidate_open_${c.position}`,
              text: { type: "plain_text", text: String(c.position) },
              value: c.id,
            })),
            { type: "button", action_id: "round_reject", text: { type: "plain_text", text: "None of these" }, value: round.id },
            ...(missing > 0 ? [retryButton(round.id, missing)] : []),
          ],
        },
      ];
    } else {
      // Flow 3, Branches: all four failing is posted, because silence looks like "still generating".
      const reasons = [...new Set(round.candidates.map((c) => c.error).filter(Boolean))].join("; ");
      blocks = [
        { type: "section", text: { type: "mrkdwn", text: `${summary}\n\n⚠️  None of the ${round.candidates.length} candidates generated. ${reasons}` } },
        { type: "actions", elements: [retryButton(round.id, missing)] },
      ];
    }

    const text = `${product.sku}: ${succeeded.length} candidates ready for review`;
    const target =
      round.messageChannelId && round.messageTs
        ? { channel: round.messageChannelId, ts: round.messageTs }
        : idea.cardChannelId && idea.cardTs
          ? { channel: idea.cardChannelId, ts: idea.cardTs }
          : null;

    let channel: string;
    let ts: string | null;
    if (target) {
      await withFreshFile(() => web.chat.update({ ...target, text, blocks: blocks as never }));
      ({ channel, ts } = target);
    } else {
      const message = await withFreshFile(() =>
        web.chat.postMessage({ channel: install.channelId!, text, blocks: blocks as never, unfurl_links: false }),
      );
      channel = message.channel ?? install.channelId;
      ts = message.ts ?? null;
    }
    await db.round.update({
      where: { id: round.id },
      data: { messageChannelId: channel, messageTs: ts, postedAt: new Date() },
    });
    log.info({ round: round.id, ts, inPlace: Boolean(target) }, "round shown");
  }
}

/** Flow 3, Branches: a round that came back short offers to retry the missing ones. */
function retryButton(roundId: string, missing: number) {
  return {
    type: "button",
    action_id: "round_retry_missing",
    text: { type: "plain_text", text: `Retry ${missing} missing` },
    value: roundId,
  };
}

export type GenerationDeps = Deps;
