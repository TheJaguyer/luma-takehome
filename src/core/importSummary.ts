// Flow 1, Step 4: the import summary — the only message most imports produce. Built from the
// drop's stored report, so the worker (first post) and the bot (rename, theme answered) render it
// identically.
import type { KnownBlock } from "@slack/types";
import { DRAFT_ESTIMATE_PER_PRODUCT_USD } from "./drafting.js";

export type ImportReport = {
  rowCount: number;
  created: string[];
  newIdeas: string[]; // existing products whose sheet idea changed
  unchanged: number;
  notApplied: { sku: string; fields: string[] }[];
  rejected: { line: number; sku: string | null; reason: string }[];
  photoProblems: { line: number; sku: string; reason: string }[];
  needsPhoto: string[]; // no source photo at all after this import
  toDraft: number;
  houseStyleSkipped: boolean; // said once, on the first import after setup skipped it
};

type SummaryInput = {
  drop: {
    id: string;
    name: string;
    filename: string;
    themeAnsweredAt: Date | null;
    themeAnsweredBy: string | null;
    state: string;
  };
  report: ImportReport;
  themeName: string | null;
  themes: { id: string; name: string }[];
};

/** Section text caps at 3,000 characters; a list of SKUs must not be what breaks the message. */
const listSkus = (skus: string[], max = 10) =>
  skus.length <= max ? skus.join(", ") : `${skus.slice(0, max).join(", ")} and ${skus.length - max} more`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Shown so "free" is never implied (#13). */
const draftingCost = (n: number) => Math.max(0.01, n * DRAFT_ESTIMATE_PER_PRODUCT_USD);

export function importSummaryBlocks({ drop, report, themeName, themes }: SummaryInput): KnownBlock[] {
  const lines: string[] = [];
  if (report.created.length) lines.push(`✅  ${plural(report.created.length, "new product")} created`);
  if (report.newIdeas.length) lines.push(`💡  ${plural(report.newIdeas.length, "existing product")} with a new shot idea`);
  if (report.unchanged) lines.push(`⏸  ${report.unchanged} already here, unchanged`);
  if (report.notApplied.length) {
    // Honesty debt from REQUIREMENTS Part 5: say out loud that these were not applied.
    lines.push(
      `✏️  ${plural(report.notApplied.length, "existing product")} differ from this file — *not applied*. ` +
        `Reviewing changes to existing products isn't built yet, so I kept what I already had.`,
    );
  }
  const problems = [
    report.rejected.length ? `${plural(report.rejected.length, "row")} dropped` : null,
    report.photoProblems.length ? `${plural(report.photoProblems.length, "photo")} couldn't be fetched` : null,
  ].filter(Boolean);
  if (problems.length) lines.push(`⚠️  ${problems.join(" · ")}`);
  if (report.needsPhoto.length) {
    lines.push(
      `🖼  ${plural(report.needsPhoto.length, "product needs", "products need")} a source photo before it can generate: ` +
        listSkus(report.needsPhoto) +
        "\n_Drop a photo in this channel and pick *A new product photo* — I'll ask which product._",
    );
  }
  if (lines.length === 0) lines.push("Nothing new in this file.");

  const hasDetails = report.notApplied.length || report.rejected.length || report.photoProblems.length;
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🗂  *Import complete — ${drop.filename}*\nDrop: *${drop.name}* · ${plural(report.rowCount, "row")} read`,
      },
      accessory: { type: "button", action_id: "drop_rename", text: { type: "plain_text", text: "Rename" }, value: drop.id },
    },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];
  if (hasDetails) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", action_id: "drop_details", text: { type: "plain_text", text: "Show details" }, value: drop.id }],
    });
  }

  if (report.toDraft === 0 && !drop.themeAnsweredAt) return blocks; // an empty file asks nothing

  if (drop.themeAnsweredAt) {
    const theme = themeName ? `*${themeName}*` : "no theme";
    const outcome = report.toDraft
      ? `Ideas for ${plural(report.toDraft, "product")} are being drafted.`
      : `Nothing to draft — every product here already has ${themeName ? `${themeName} ideas` : "everyday ideas"}.`;
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `🎨 Campaign: ${theme} — chosen by <@${drop.themeAnsweredBy}>. ${outcome}` }],
    });
    return blocks;
  }

  const styleNote = report.houseStyleSkipped
    ? "\n_No house style is set, so ideas will draft from product data alone. `/shots style` sets one._"
    : "";
  blocks.push(
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `One question before I draft ideas — *is this batch for a campaign?* ` +
          `Products that already have ideas for the campaign you pick are skipped, so choosing one here ` +
          `starts that campaign for everything in the file. Drafting starts either way (up to about ` +
          `$${draftingCost(report.toDraft).toFixed(2)}). No image is generated until you approve an idea.${styleNote}`,
      },
    },
    {
      type: "actions",
      elements: [
        { type: "button", action_id: "drop_theme_none", text: { type: "plain_text", text: "No theme" }, value: drop.id },
        // Existing themes are one-tap chips: picking beats typing, which keeps the vocabulary small (Flow 7, Step 4).
        ...themes.slice(0, 3).map((t) => ({
          type: "button" as const,
          action_id: `drop_theme_pick_${t.id}`,
          text: { type: "plain_text" as const, text: t.name },
          value: `${drop.id}:${t.id}`,
        })),
        { type: "button", action_id: "drop_theme_new", text: { type: "plain_text", text: "New theme…" }, value: drop.id },
      ],
    },
  );
  return blocks;
}

export function importDetailsText(report: ImportReport) {
  const sections: string[] = [];
  if (report.rejected.length) {
    sections.push(
      "*Rows dropped* — fix these in the sheet and import again:\n" +
        report.rejected.map((r) => `• Row ${r.line}  ${r.sku ?? "(blank)"}  ${r.reason}`).join("\n"),
    );
  }
  if (report.photoProblems.length) {
    sections.push(
      "*Photos I couldn't fetch* — the products imported without them:\n" +
        report.photoProblems.map((p) => `• Row ${p.line}  ${p.sku}  ${p.reason}`).join("\n"),
    );
  }
  if (report.notApplied.length) {
    sections.push(
      "*Differences not applied* — I kept what I already had:\n" +
        report.notApplied.map((c) => `• ${c.sku}  ${c.fields.join(", ")}`).join("\n"),
    );
  }
  return sections.join("\n\n");
}
