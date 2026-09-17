// Flows 5 and 6 in Slack. One gesture — drop an image in the channel — and two nearly opposite
// meanings, so the fork is explicit rather than inferred (decision 5.1): a white-background photo
// approved as a candidate puts a catalogue shot on the product page, and a finished lifestyle shot
// used as a generation source produces scenes built on top of a scene.
//
// The two options are written as what each one *does next*, including the cost, rather than as
// "source photo" versus "finished shot" — terms that mean nothing to a freelancer.
import type { S3Client } from "@aws-sdk/client-s3";
import type { App } from "@slack/bolt";
import type { KnownBlock, View } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import sharp from "sharp";
import { productTitle, usd } from "../core/ideaCards.js";
import { deciderLabel, displayName } from "../core/people.js";
import { fetchSlackFile, PhotoFetchError, storeSourcePhotoBytes } from "../core/sourcePhotos.js";
import { isApprover, recordEvent } from "../core/team.js";
import { approveUpload, declineUpload, replaceSourcePhoto } from "../core/uploads.js";
import { refreshUploadMessage, uploadMessageBlocks } from "../core/uploadMessage.js";
import type { Db } from "../lib/db.js";
import { EDIT_PRICE_USD } from "../lib/luma.js";
import { uploadImage, withFreshFile } from "../lib/slack.js";
import { getObjectBytes, keys, publicImageUrl, putObject } from "../lib/storage.js";
import { bestEffort, postLiveChangeNotice } from "./candidates.js";
import { actionContext } from "./setup.js";

type Deps = { app: App; db: Db; log: Logger; s3: S3Client; bucket: string; publicBaseUrl: string; botToken: string };

type SlackFile = { id: string; name?: string; filetype?: string; mimetype?: string; url_private_download?: string; url_private?: string };
type Fork = { fileId: string; channel: string; ts: string; threadTs?: string };

const IMAGE_TYPES = ["jpg", "jpeg", "png", "webp", "heic", "gif", "tiff", "bmp"];

export function registerUploads({ app, db, log, s3, bucket, publicBaseUrl, botToken }: Deps) {
  // Step 1: the same gesture as a CSV drop (Flow 1) — no command to remember, and it works from a
  // phone, which is where a photographer is.
  app.event("message", async ({ event, client }) => {
    const e = event as { subtype?: string; bot_id?: string; channel: string; ts: string; thread_ts?: string; user?: string; files?: SlackFile[] };
    if (e.subtype !== "file_share" || e.bot_id || !e.user || !e.files?.length) return;

    const install = await db.install.findFirst({ where: { channelId: e.channel } });
    if (!install) return;
    const images = e.files.filter((f) => IMAGE_TYPES.includes((f.filetype ?? "").toLowerCase()) || (f.mimetype ?? "").startsWith("image/"));
    if (images.length === 0) return; // a CSV or a spreadsheet: registerImports has it
    if (install.setupStage !== "COMPLETE") return;

    // Dropped in a product's thread, the SKU is known and only the kind is asked.
    const inThread = e.thread_ts && e.thread_ts !== e.ts ? await productForMessage(db, e.channel, e.thread_ts) : null;

    for (const file of images) {
      const fork: Fork = { fileId: file.id, channel: e.channel, ts: e.ts, ...(inThread ? { threadTs: e.thread_ts } : {}) };
      await client.chat.postMessage({
        channel: e.channel,
        thread_ts: e.ts,
        text: "What is this photo for?",
        blocks: forkBlocks(fork, inThread, install.candidatesPerRound * (EDIT_PRICE_USD[install.defaultModel] ?? 0)),
      });
    }
  });

  app.action(/^upload_kind_(shot|source)$/, async ({ ack, body, client }) => {
    await ack();
    const { value, triggerId, teamId } = actionContext(body);
    const fork = JSON.parse(value) as Fork;
    const kind = ((body as { actions: { action_id: string }[] }).actions[0]!.action_id.endsWith("shot") ? "shot" : "source") as "shot" | "source";
    const product = fork.threadTs ? await productForMessage(db, fork.channel, fork.threadTs) : null;
    const themes = kind === "shot" ? await db.theme.findMany({ where: { teamId }, orderBy: { createdAt: "desc" } }) : [];
    await client.views.open({ trigger_id: triggerId, view: kindModal(kind, fork, product, themes) });
  });

  // Typeahead over the catalogue: 300 SKUs is past what a static dropdown holds, and typing three
  // characters of a name is faster than scrolling either way.
  app.options("upload_product", async ({ options, ack }) => {
    const q = (options.payload as { value?: string }).value?.trim() ?? "";
    const teamId = (options.body as { team?: { id: string } }).team?.id ?? "";
    const products = await db.product.findMany({
      where: {
        teamId,
        ...(q ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { sku: "asc" },
      take: 100,
    });
    await ack({
      options: products.map((p) => ({ text: { type: "plain_text" as const, text: productTitle(p).slice(0, 75) }, value: p.id })),
    });
  });

  app.view("upload_kind_modal", async ({ ack, body, view, client }) => {
    const meta = JSON.parse(view.private_metadata) as { kind: "shot" | "source"; fork: Fork; productId: string | null };
    const values = view.state.values;
    const productId = meta.productId ?? values.product?.upload_product?.selected_option?.value ?? null;
    const ai = values.ai?.value?.selected_option?.value ?? null;
    const errors: Record<string, string> = {};
    if (!productId) errors.product = "Which product is this photo of?";
    if (!ai) errors.ai = "Say yes or no — it's recorded with the image and never guessed.";
    if (Object.keys(errors).length) return ack({ response_action: "errors", errors });
    await ack();

    const teamId = body.team!.id;
    const userId = body.user.id;
    const themeId = values.theme?.value?.selected_option?.value || null;
    const aiGenerated = ai === "yes";
    const product = await db.product.findUniqueOrThrow({ where: { id: productId! } });

    let bytes: Buffer;
    try {
      const info = (await client.files.info({ file: meta.fork.fileId })) as { file?: SlackFile };
      const url = info.file?.url_private_download ?? info.file?.url_private;
      if (!url) throw new PhotoFetchError("I couldn't read that file from Slack");
      bytes = await fetchSlackFile(url, botToken);
    } catch (err) {
      const why = err instanceof PhotoFetchError ? err.message : "I couldn't read that file";
      await client.chat.postEphemeral({ channel: meta.fork.channel, user: userId, text: `⚠️  ${why}. Try dropping it again.` });
      return;
    }

    if (meta.kind === "shot") {
      await createUploadCandidate({ db, s3, bucket }, client, log, { teamId, product, themeId, aiGenerated, userId, fork: meta.fork, bytes });
      return;
    }
    await proposeSourceReplacement({ db, s3, bucket }, client, log, { teamId, product, userId, fork: meta.fork, bytes, aiGenerated });
  });

  // Flow 6, Step 1: the confirmation, with both photos and the cost on the button.
  app.action("source_replace", async ({ ack, body, client }) => {
    await ack();
    const { value, userId, teamId, channelId, messageTs } = actionContext(body);
    const { sourcePhotoId, productId } = JSON.parse(value) as { sourcePhotoId: string; productId: string };
    // The keep / start-over radio, if the message asked (decision 6.1).
    const state = (body as { state?: { values?: Record<string, Record<string, { selected_option?: { value: string } }>> } }).state?.values ?? {};
    const startOver = state.approved_images?.approved_images_choice?.selected_option?.value === "start_over";
    const approver = await isApprover(db, teamId, userId);

    const result = await replaceSourcePhoto(db, { productId, sourcePhotoId, startOver }, { userId, forced: !approver, reason: null });
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    if (!result.ok) {
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: "That photo is already this product's source." });
      return;
    }
    const outcome = result.startedOver
      ? "Back to idea review — ideas are being redrafted against the new photo. Anything already live stays live until new images replace it."
      : result.roundStarted
        ? `🎨 Generating ${result.candidates} candidates · ${usd(result.estimateUsd)} — they'll appear on ${product.sku}'s message.`
        : "No approved idea yet, so nothing generates. It'll go to idea review as normal.";
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `${product.sku}: source photo replaced`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `🔄  *${productTitle(product)}* — new product photo (<@${userId}>).\n${outcome}` } }],
    });
    log.info({ sku: product.sku, startOver, roundStarted: result.roundStarted }, "source photo replaced");
  });

  app.action("source_cancel", async ({ ack, body, client }) => {
    await ack();
    const { userId, channelId, messageTs } = actionContext(body);
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: "Cancelled",
      blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `~Replace the product photo~ · cancelled by <@${userId}>. Nothing changed.` }] }],
    });
  });

  // Slack requires an action handler for an input left in a message; the radio only carries state.
  app.action("approved_images_choice", async ({ ack }) => ack());

  // Flow 5, Step 2: the same two taps as a generated candidate, and the same comparison.
  app.action("upload_open", async ({ ack, body, client }) => {
    await ack();
    const { value, triggerId, teamId, userId } = actionContext(body);
    const view = await uploadModal(db, client, value, !(await isApprover(db, teamId, userId)));
    if (view) await client.views.open({ trigger_id: triggerId, view });
  });

  app.view("upload_modal", async ({ ack, body, view, client }) => {
    const { uploadId } = JSON.parse(view.private_metadata) as { uploadId: string };
    const approver = await isApprover(db, body.team!.id, body.user.id);
    const reason = view.state.values.reason?.value?.value?.trim() ?? null;
    if (!approver && (!reason || reason.length < 3)) {
      return ack({ response_action: "errors", errors: { reason: "Say why in a few words — it's posted with the approval." } });
    }
    await ack();
    const result = await approveUpload({ db, s3, bucket }, uploadId, { userId: body.user.id, forced: !approver, reason: approver ? null : reason });
    const upload = await db.upload.findUniqueOrThrow({ where: { id: uploadId } });
    if (!result.ok) {
      if (upload.messageChannelId) {
        await client.chat.postEphemeral({ channel: upload.messageChannelId, user: body.user.id, text: "That photo is already approved." });
      }
      return;
    }
    await refreshUploadMessage(db, client, uploadId);
    const by = await deciderLabel(db, client, body.team!.id, body.user.id);
    await bestEffort(log, "post the approval notice", () =>
      postLiveChangeNotice(client, upload, {
        kind: "approved",
        sku: result.product.sku,
        theme: result.theme,
        headline: result.headline,
        isPrimary: result.isPrimary,
        live: result.live,
        themeLive: result.themeLive,
        by,
        forced: !approver,
        reason: approver ? null : reason,
        imageId: result.image.id,
        url: publicImageUrl(publicBaseUrl, result.image.publicKey),
      }),
    );
    log.info({ image: result.image.id, sku: result.product.sku, origin: "photographer" }, "uploaded image approved");
  });

  // Free, like [None of these] (decision 3.2): nothing was spent, and uploading again undoes it.
  app.action("upload_decline", async ({ ack, body, client }) => {
    await ack();
    const { value, userId } = actionContext(body);
    if (await declineUpload(db, value, userId)) await refreshUploadMessage(db, client, value);
  });
}

/** The product a message belongs to: its round's, or its idea card's (one product, one message). */
async function productForMessage(db: Db, channel: string, ts: string) {
  const round = await db.round.findFirst({ where: { messageChannelId: channel, messageTs: ts }, include: { product: true } });
  if (round) return round.product;
  const idea = await db.idea.findFirst({ where: { cardChannelId: channel, cardTs: ts }, include: { product: true } });
  if (idea) return idea.product;
  const upload = await db.upload.findFirst({ where: { messageChannelId: channel, messageTs: ts }, include: { product: true } });
  return upload?.product ?? null;
}

function forkBlocks(fork: Fork, product: { sku: string; name: string | null } | null, estimate: number): KnownBlock[] {
  const value = JSON.stringify(fork);
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `🖼  *Got it — what is this photo for?*${product ? `\nProduct: *${product.sku}*${product.name ? ` · ${product.name}` : ""}` : ""}\n\n` +
          "*A finished shot* — goes straight to review as a candidate. Nothing is generated.\n" +
          `*A new product photo* — replaces the source and generates ${estimate > 0 ? `4 new candidates · ${usd(estimate)}` : "new candidates"}.`,
      },
    },
    {
      type: "actions",
      elements: [
        { type: "button", action_id: "upload_kind_shot", style: "primary", text: { type: "plain_text", text: "A finished shot" }, value },
        { type: "button", action_id: "upload_kind_source", text: { type: "plain_text", text: "A new product photo" }, value },
      ],
    },
  ];
}

function kindModal(kind: "shot" | "source", fork: Fork, product: { id: string; sku: string; name: string | null } | null, themes: { id: string; name: string }[]): View {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          kind === "shot"
            ? "🖼  *A finished shot* — it becomes a candidate awaiting a decision. Nothing goes live until someone approves it."
            : "🔄  *A new product photo* — it replaces what generations are built from. I'll show you both before anything changes.",
      },
    },
  ];
  if (product) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Product: *${product.sku}*${product.name ? ` · ${product.name}` : ""}` }] });
  } else {
    blocks.push({
      type: "input",
      block_id: "product",
      label: { type: "plain_text", text: "Which product?" },
      element: { type: "external_select", action_id: "upload_product", min_query_length: 0, placeholder: { type: "plain_text", text: "Type a SKU or a name" } },
    });
  }
  if (kind === "shot" && themes.length) {
    blocks.push({
      type: "input",
      block_id: "theme",
      optional: true,
      label: { type: "plain_text", text: "Which set does it join?" },
      element: {
        type: "static_select",
        action_id: "value",
        placeholder: { type: "plain_text", text: "Everyday" },
        options: themes.slice(0, 20).map((t) => ({ text: { type: "plain_text" as const, text: t.name }, value: t.id })),
      },
    });
  }
  // #16: asked of every upload, never inferred. Origin recorded wrongly is worse than origin
  // unknown — it is a provenance record that lies, and the disclosure decision depends on it.
  blocks.push({
    type: "input",
    block_id: "ai",
    label: { type: "plain_text", text: "Was it made with AI?" },
    element: {
      type: "radio_buttons",
      action_id: "value",
      options: [
        { text: { type: "plain_text", text: "No — a real photograph" }, value: "no" },
        { text: { type: "plain_text", text: "Yes — generated or AI-edited" }, value: "yes" },
      ],
    },
  });
  return {
    type: "modal",
    callback_id: "upload_kind_modal",
    private_metadata: JSON.stringify({ kind, fork, productId: product?.id ?? null }),
    title: { type: "plain_text", text: kind === "shot" ? "A finished shot" : "A new photo" },
    submit: { type: "plain_text", text: kind === "shot" ? "Send to review" : "Next" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

type Ctx = { db: Db; s3: S3Client; bucket: string };
type Common = { teamId: string; product: { id: string; sku: string; name: string | null; color: string | null }; userId: string; fork: Fork; bytes: Buffer };

async function createUploadCandidate(
  { db, s3, bucket }: Ctx,
  client: WebClient,
  log: Logger,
  a: Common & { themeId: string | null; aiGenerated: boolean },
) {
  const meta = await sharp(a.bytes).metadata();
  const jpeg = await sharp(a.bytes).jpeg({ quality: 92 }).toBuffer();
  const upload = await db.upload.create({
    data: {
      teamId: a.teamId,
      productId: a.product.id,
      themeId: a.themeId,
      storageKey: "", // filled below, once the row's id names the object
      contentType: "image/jpeg",
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      aiGenerated: a.aiGenerated,
      uploadedBy: a.userId,
    },
  });
  const storageKey = keys.upload(upload.id, "jpg");
  await putObject(s3, bucket, storageKey, jpeg, "image/jpeg");
  const slackFileId = await uploadImage(client, jpeg, `${a.product.sku}-upload.jpg`, `${a.product.sku} uploaded photo`);
  await db.upload.update({ where: { id: upload.id }, data: { storageKey, slackFileId } });
  await recordEvent(db, {
    teamId: a.teamId,
    actor: a.userId,
    type: "upload.received",
    productId: a.product.id,
    data: { uploadId: upload.id, aiGenerated: a.aiGenerated, width: meta.width ?? 0, height: meta.height ?? 0 },
  });

  const view = {
    id: upload.id,
    product: a.product,
    theme: a.themeId ? (await db.theme.findUnique({ where: { id: a.themeId } }))?.name ?? null : null,
    slackFileId,
    aiGenerated: a.aiGenerated,
    uploadedBy: await displayName(client, a.userId),
    approved: false,
    approvedBy: null,
    declinedBy: null,
    live: await db.image.count({ where: { productId: a.product.id, themeId: a.themeId, revokedAt: null } }),
  };
  const posted = await withFreshFile(() =>
    client.chat.postMessage({ channel: a.fork.channel, text: `${a.product.sku}: uploaded photo`, blocks: uploadMessageBlocks(view) }),
  );
  await db.upload.update({ where: { id: upload.id }, data: { messageChannelId: posted.channel, messageTs: posted.ts } });
  log.info({ upload: upload.id, sku: a.product.sku, ai: a.aiGenerated }, "upload received");
}

/**
 * Flow 6, Steps 1, 4 and 5. The version is filed first and the pointer moved only on confirm, so
 * the message can show both photos — showing them side by side is the whole safeguard. The failure
 * it prevents is replacing the Charcoal variant's photo with the Smoke one: invisible in a
 * filename, obvious in a pair of pictures.
 */
async function proposeSourceReplacement(
  { db, s3, bucket }: Ctx,
  client: WebClient,
  log: Logger,
  a: Common & { aiGenerated: boolean },
) {
  let photo: Awaited<ReturnType<typeof storeSourcePhotoBytes>>;
  try {
    photo = await storeSourcePhotoBytes({ db, s3, bucket }, a.product, a.bytes, a.userId, { makeCurrent: false });
  } catch (err) {
    const why = err instanceof PhotoFetchError ? err.message : "I couldn't read that file";
    await client.chat.postEphemeral({ channel: a.fork.channel, user: a.userId, text: `⚠️  ${why}.` });
    return;
  }

  const product = await db.product.findUniqueOrThrow({ where: { id: a.product.id }, include: { currentSourcePhoto: true } });
  const install = await db.install.findUniqueOrThrow({ where: { teamId: a.teamId } });
  const live = await db.image.count({ where: { productId: product.id, revokedAt: null } });
  const estimate = install.candidatesPerRound * (EDIT_PRICE_USD[install.defaultModel] ?? 0);
  const idea = await db.idea.findFirst({ where: { productId: product.id, state: "APPROVED" }, include: { approvedOption: true }, orderBy: { createdAt: "desc" } });

  const newFileId = await uploadImage(client, a.bytes, `${product.sku}-v${photo.version}.jpg`, `${product.sku} new product photo`);
  let currentFileId: string | null = null;
  if (product.currentSourcePhoto) {
    const bytes = await getObjectBytes(s3, bucket, product.currentSourcePhoto.storageKey).catch(() => null);
    // The stored source keeps its own format (png/webp/jpg); Slack reads the extension.
    const ext = product.currentSourcePhoto.storageKey.split(".").pop() ?? "jpg";
    if (bytes) currentFileId = await uploadImage(client, bytes, `${product.sku}-current.${ext}`, `${product.sku} current product photo`);
  }

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `🔄  *New product photo — ${productTitle(product)}*\n` +
          (currentFileId ? `Current is version ${product.currentSourcePhoto!.version}; the new one would be version ${photo.version}.` : "This product has no source photo yet — this would be its first."),
      },
    },
  ];
  if (currentFileId) blocks.push({ type: "image", slack_file: { id: currentFileId }, title: { type: "plain_text", text: "Current" }, alt_text: `${product.sku} current photo` });
  blocks.push({ type: "image", slack_file: { id: newFileId }, title: { type: "plain_text", text: "New" }, alt_text: `${product.sku} new photo` });

  if (idea) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Idea: “${idea.approvedOption?.headline ?? "Written in Slack"}” (already approved)` }] });
  }
  // Decision 6.2: accept a non-square photo, and say plainly what it will do. Luma takes its
  // output size from the source (#15), so this is how a 4:3 product page image happens.
  if (photo.width && photo.height && photo.width !== photo.height) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `⚠️  This photo is ${photo.width} × ${photo.height}, not square. Images generated from it will be that shape too — the model takes its output size from the source photo, and the product page is probably expecting square.`,
        },
      ],
    });
  }
  // Decision 6.1: the question is about the action, not about a classification. Asked only when
  // there is something to ask about.
  if (live > 0) {
    blocks.push({
      type: "section",
      block_id: "approved_images",
      text: { type: "mrkdwn", text: `*${product.sku} has ${live} approved image${live === 1 ? "" : "s"}, live now.*` },
      accessory: {
        type: "radio_buttons",
        action_id: "approved_images_choice",
        initial_option: { text: { type: "plain_text", text: "Keep them" }, description: { type: "plain_text", text: "A better photo of the same product. Nothing live changes." }, value: "keep" },
        options: [
          { text: { type: "plain_text", text: "Keep them" }, description: { type: "plain_text", text: "A better photo of the same product. Nothing live changes." }, value: "keep" },
          { text: { type: "plain_text", text: "Start over" }, description: { type: "plain_text", text: `Back to idea review for this SKU. The ${live} stay live until new ones replace them.` }, value: "start_over" },
        ],
      },
    });
  }
  const value = JSON.stringify({ sourcePhotoId: photo.id, productId: product.id });
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: "source_replace",
        style: "primary",
        text: { type: "plain_text", text: idea ? `Replace and generate ${install.candidatesPerRound} · ${usd(estimate)}` : "Replace" },
        value,
      },
      { type: "button", action_id: "source_cancel", text: { type: "plain_text", text: "Cancel" }, value },
    ],
  });
  if (!idea) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "No approved idea yet, so nothing generates — it goes to idea review as normal." }] });
  }
  if (a.aiGenerated) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "⚠️ Recorded as AI-made. Generating a scene on top of a generated photo compounds the drift from the real product (#14)." }] });
  }

  const posted = await withFreshFile(() =>
    client.chat.postMessage({ channel: a.fork.channel, text: `${product.sku}: replace the product photo?`, blocks }),
  );
  log.info({ sku: product.sku, version: photo.version, ts: posted.ts }, "source photo replacement proposed");
}

async function uploadModal(db: Db, web: WebClient, uploadId: string, needsReason: boolean): Promise<View | null> {
  const upload = await db.upload.findUnique({
    where: { id: uploadId },
    include: { product: { include: { currentSourcePhoto: true } }, image: true },
  });
  if (!upload?.slackFileId) return null;
  const approved = upload.image && !upload.image.revokedAt ? upload.image : null;
  const open = !approved && !upload.declinedAt;
  const [approvedBy, uploadedBy] = await Promise.all([
    deciderLabel(db, web, upload.teamId, approved?.approvedBy ?? null),
    displayName(web, upload.uploadedBy),
  ]);

  const blocks: KnownBlock[] = [{ type: "image", slack_file: { id: upload.slackFileId }, alt_text: `${upload.product.sku} uploaded photo` }];
  // The same fidelity check as a generated candidate (decision 3.1): does this show the product?
  if (upload.product.currentSourcePhoto?.originalUrl) {
    blocks.push(
      { type: "context", elements: [{ type: "mrkdwn", text: "Check product accuracy with the source below" }] },
      { type: "image", image_url: upload.product.currentSourcePhoto.originalUrl, alt_text: `${upload.product.sku} product photo` },
    );
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: approved
          ? `✅ Approved${approvedBy ? ` by ${approvedBy}` : ""}`
          : `Uploaded by ${uploadedBy}${upload.aiGenerated ? " · ⚠️ declared AI-made" : " · not AI"}. Approving puts it on the product page.`,
      },
    ],
  });
  if (open && needsReason) {
    blocks.push(
      { type: "context", elements: [{ type: "mrkdwn", text: "⚠️ You're not the approver, so this is a force-approve. It goes live immediately, and the record will show you approved it without an approver." }] },
      { type: "input", block_id: "reason", label: { type: "plain_text", text: "Why are you deciding this now?" }, element: { type: "plain_text_input", action_id: "value", max_length: 300 } },
    );
  }
  return {
    type: "modal",
    callback_id: "upload_modal",
    private_metadata: JSON.stringify({ uploadId }),
    title: { type: "plain_text", text: `${upload.product.sku} · uploaded`.slice(0, 24) },
    close: { type: "plain_text", text: "Back" },
    ...(open ? { submit: { type: "plain_text" as const, text: needsReason ? "Approve anyway" : "Approve" } } : {}),
    blocks,
  };
}
