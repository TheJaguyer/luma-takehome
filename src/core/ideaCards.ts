// Flow 2, Steps 1–3: the queue message and one card per product. Everything is a fight for
// vertical space on a phone: one-line headlines, the full scene one tap away.
import type { KnownBlock } from "@slack/types";

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣"];
export const usd = (n: number) => `$${n.toFixed(2)}`;

export type CardIdea = {
  id: string;
  rawSheetIdea: string | null;
  themeName: string | null;
  options: { position: number; headline: string; prompt: string }[];
  product: {
    sku: string;
    name: string | null;
    color: string | null;
    price: string | null;
    notes: string | null;
    priority: boolean;
    photoUrl: string | null;
    hasSourcePhoto: boolean;
  };
};

export function productTitle(p: { sku: string; name: string | null; color: string | null; price?: string | null }) {
  return [p.sku, p.name, p.color, p.price].filter(Boolean).join(" · ");
}

export function ideaCardBlocks(idea: CardIdea): KnownBlock[] {
  const p = idea.product;
  const heading = `💡  *${productTitle(p)}*${p.priority ? "   ⭐ priority" : ""}`;
  const context = [
    idea.rawSheetIdea ? `*Sheet idea:* “${idea.rawSheetIdea}”` : null,
    p.notes ? `*Note:* “${p.notes}”` : null,
    idea.themeName ? `*Campaign:* ${idea.themeName}` : null,
    p.hasSourcePhoto
      ? null
      : "⚠️ *Needs a source photo* — approving records the idea, but nothing generates until one arrives. Drop a photo in this channel and pick *A new product photo*.",
  ].filter(Boolean) as string[];

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: heading },
      // The source photo, because "does this scene suit this product" isn't answerable from a SKU.
      ...(p.photoUrl && p.hasSourcePhoto
        ? { accessory: { type: "image" as const, image_url: p.photoUrl, alt_text: `${p.sku} product photo` } }
        : {}),
    },
  ];
  if (context.length) blocks.push({ type: "context", elements: context.map((text) => ({ type: "mrkdwn" as const, text })) });
  blocks.push(
    {
      type: "section",
      text: { type: "mrkdwn", text: idea.options.map((o) => `${NUMBERS[o.position - 1]}  ${o.headline}`).join("\n") },
    },
    {
      type: "actions",
      elements: [
        ...idea.options.map((o) => ({
          type: "button" as const,
          action_id: `idea_pick_${o.position}`,
          text: { type: "plain_text" as const, text: String(o.position) },
          value: idea.id,
        })),
        { type: "button", action_id: "idea_details", text: { type: "plain_text", text: "Details" }, value: idea.id },
        {
          type: "overflow",
          action_id: "idea_more",
          options: [
            ...idea.options.map((o) => ({ text: { type: "plain_text" as const, text: `Edit ${o.position}…` }, value: `edit:${o.position}:${idea.id}` })),
            { text: { type: "plain_text", text: "Write my own…" }, value: `own::${idea.id}` },
            { text: { type: "plain_text", text: "Skip for now" }, value: `skip::${idea.id}` },
          ],
        },
      ],
    },
  );
  return blocks;
}

/** A decided card collapses to one line, so the queue shrinks as it is worked (Flow 2, Step 2). */
export function decidedCardBlocks(d: {
  ideaId: string;
  sku: string;
  state: "APPROVED" | "SKIPPED";
  headline?: string;
  userId: string;
  forced: boolean;
  reason: string | null;
  generation?: { started: boolean; candidates: number; estimateUsd: number };
}): KnownBlock[] {
  if (d.state === "SKIPPED") {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: `⏭  ${d.sku} · skipped by <@${d.userId}>` },
        accessory: { type: "button", action_id: "idea_unskip", text: { type: "plain_text", text: "Review again" }, value: d.ideaId },
      },
    ];
  }
  const forced = d.forced ? `  ·  ⚠️ force-approved: “${d.reason}”` : "";
  const gen = d.generation?.started
    ? `🎨 generating ${d.generation.candidates} candidates · ${usd(d.generation.estimateUsd)} — they'll appear right here`
    : "not generating — needs a source photo first";
  return [
    { type: "section", text: { type: "mrkdwn", text: `✅  ${d.sku} · “${d.headline}” · <@${d.userId}>${forced}\n${gen}` } },
  ];
}

export function queueMessageBlocks(q: {
  dropName: string;
  ready: number;
  priority: string[];
  failed: string[];
  candidatesPerRound: number;
  estimateUsd: number;
}): KnownBlock[] {
  const lines = [
    `💡  *${q.ready} ideas ready to review — ${q.dropName}*`,
    q.priority.length ? `⭐ Priority first: ${q.priority.join(", ")}` : null,
    // Spend up front and for the whole batch: the moment "don't burn our budget" is actionable (#13).
    `Approving all of them would generate ${q.ready * q.candidatesPerRound} candidates · about ${usd(q.estimateUsd)}`,
    q.failed.length ? `⚠️ I couldn't draft ideas for ${q.failed.join(", ")} — \`/shots ideas\` retries them.` : null,
    "Nothing is generated until you approve an idea. Tap a number to approve it.",
  ].filter(Boolean);
  return [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }];
}
