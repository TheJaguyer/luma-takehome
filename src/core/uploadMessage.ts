// Flow 5, Step 2: an uploaded photo's own message. Like a round's (productMessage.ts) it is a
// pure rendering of state, so approving, reverting and declining all end by re-rendering it.
//
// It is a separate message rather than a slot in the round's contact sheet: a human shot has no
// round, no cost and no model, and putting it in a 2×2 of generated candidates would imply it did.
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { Db } from "../lib/db.js";
import { productTitle } from "./ideaCards.js";
import { DONE_AT } from "./imageApproval.js";
import { deciderLabel, displayName } from "./people.js";

export type UploadView = {
  id: string;
  product: { sku: string; name: string | null; color: string | null };
  theme: string | null;
  slackFileId: string | null;
  aiGenerated: boolean;
  // Names, not ids — this message re-renders in place like a round's (src/core/people.ts).
  uploadedBy: string;
  approved: boolean;
  approvedBy: string | null;
  declinedBy: string | null;
  live: number; // live images in this upload's set
};

export function uploadMessageBlocks(v: UploadView): KnownBlock[] {
  const title = productTitle(v.product) + (v.theme ? `  ·  🎨 ${v.theme}` : "");
  // #16: what the uploader said, in the message itself — the record is only useful if it is read.
  const provenance = `From ${v.uploadedBy} · photographer${v.aiGenerated ? " · ⚠️ made with AI" : " · not AI"}`;
  const section = (text: string): KnownBlock => ({ type: "section", text: { type: "mrkdwn", text } });

  if (v.declinedBy && !v.approved) {
    return [section(`⏭  *${title}* — uploaded photo not used${v.declinedBy ? ` (${v.declinedBy})` : ""}. Upload another any time.`)];
  }

  const blocks: KnownBlock[] = [
    section(
      `🖼  *${title}*\n1 candidate · uploaded, no generation cost\n${provenance}` +
        (v.approvedBy !== undefined && v.approved ? `\n✅ Approved${v.approvedBy ? ` by ${v.approvedBy}` : ""} · ${v.live} live${v.live < DONE_AT ? ` · needs ${DONE_AT - v.live} more` : ""}` : ""),
    ),
  ];
  if (v.slackFileId) blocks.push({ type: "image", slack_file: { id: v.slackFileId }, alt_text: `${v.product.sku} uploaded photo` });
  if (!v.approved) {
    blocks.push({
      type: "actions",
      elements: [
        { type: "button", action_id: "upload_open", style: "primary", text: { type: "plain_text", text: "Review it" }, value: v.id },
        { type: "button", action_id: "upload_decline", text: { type: "plain_text", text: "Not this one" }, value: v.id },
      ],
    });
  }
  return blocks;
}

export async function loadUploadView(db: Db, web: WebClient, uploadId: string): Promise<UploadView & { channel: string | null; ts: string | null }> {
  const upload = await db.upload.findUniqueOrThrow({
    where: { id: uploadId },
    include: { product: true, theme: true, image: true },
  });
  const approved = upload.image && !upload.image.revokedAt ? upload.image : null;
  return {
    id: upload.id,
    channel: upload.messageChannelId,
    ts: upload.messageTs,
    product: upload.product,
    theme: upload.theme?.name ?? null,
    slackFileId: upload.slackFileId,
    aiGenerated: upload.aiGenerated,
    uploadedBy: await displayName(web, upload.uploadedBy),
    approved: Boolean(approved),
    approvedBy: await deciderLabel(db, web, upload.teamId, approved?.approvedBy ?? null),
    declinedBy: await deciderLabel(db, web, upload.teamId, upload.declinedBy),
    live: await db.image.count({ where: { productId: upload.productId, themeId: upload.themeId, revokedAt: null } }),
  };
}

export async function refreshUploadMessage(db: Db, web: WebClient, uploadId: string) {
  const view = await loadUploadView(db, web, uploadId);
  if (!view.channel || !view.ts) return;
  await web.chat.update({
    channel: view.channel,
    ts: view.ts,
    text: `${view.product.sku}: uploaded photo`,
    blocks: uploadMessageBlocks(view),
  });
}
