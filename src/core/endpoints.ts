// Flow 7, Step 1: everything the web developer needs, from Slack, without asking anyone.
//
// The setup message (Flow 0, Step 5) posts the base URL once, on the day the bot is installed —
// which is the wrong day for the person who wires up the site weeks later. This is the same
// contract on demand, with the themes that actually exist filled in, so "which theme names can I
// ask for?" is answered from the data rather than from memory.
import type { KnownBlock } from "@slack/types";
import type { Db } from "../lib/db.js";

const EXAMPLE_SKU = "HG-002"; // only used when the catalogue is empty

export async function endpointsMessage(db: Db, teamId: string, publicBaseUrl: string) {
  const base = publicBaseUrl.replace(/\/$/, "");
  const [themes, defaults, example] = await Promise.all([
    db.theme.findMany({
      where: { teamId },
      orderBy: { name: "asc" },
      include: { _count: { select: { images: { where: { revokedAt: null } } } } },
    }),
    db.image.count({ where: { teamId, themeId: null, revokedAt: null } }),
    // A SKU the web developer can paste and get something back from, if one exists yet.
    db.image
      .findFirst({ where: { teamId, revokedAt: null }, orderBy: { approvedAt: "desc" }, include: { product: true, theme: true } })
      .then(async (image) => image ?? (await db.product.findFirst({ where: { teamId }, orderBy: { sku: "asc" } }).then((p) => (p ? { product: p, theme: null } : null)))),
  ]);

  const sku = example?.product.sku ?? EXAMPLE_SKU;
  const exampleTheme = example && "theme" in example ? (example.theme?.name ?? null) : null;
  const plural = (n: number) => `${n} image${n === 1 ? "" : "s"}`;

  const themeRows = [
    `\`default\`  — ${plural(defaults)}   _no \`?theme\`, and the fallback for every theme_`,
    ...themes.map((t) => {
      const note = t._count.images === 0 ? "   _nothing approved yet — falls back to default_" : "";
      return `\`?theme=${t.name}\`  — ${plural(t._count.images)}${note}`;
    }),
  ];

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "🔌  *Endpoints — approved product images*\n" +
          "Read-only, no auth, no key. Approving an image changes what these return; there is no upload step and no dev work per product.\n\n" +
          `\`\`\`GET ${base}/products/{SKU}/images\nGET ${base}/products/{SKU}/images?theme={name}\`\`\``,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Themes you can ask for*\n${themeRows.join("\n")}\n\n` +
          (themes.length ? "" : "_No themes yet — they're created from an import's theme question._"),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Try it*\n\`\`\`curl '${base}/products/${sku}/images${exampleTheme ? `?theme=${exampleTheme}` : ""}'\`\`\``,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Response*\n" +
          "```{\n" +
          `  "sku": "${sku}",\n` +
          `  "requested_theme": ${exampleTheme ? `"${exampleTheme}"` : "null"},\n` +
          `  "served_theme": "${exampleTheme ?? "default"}",\n` +
          '  "images": [\n' +
          `    { "url": "${base}/images/${sku}/<id>.jpg", "primary": true,\n` +
          `      "theme": "${exampleTheme ?? "default"}", "origin": "ai",\n` +
          '      "width": 2048, "height": 2048, "approved_at": "2026-09-17T10:04:00.000Z" }\n' +
          "  ]\n}```",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*The contract*\n" +
          "• *Display order, primary first.* Use `images[0]` wherever you need exactly one.\n" +
          "• *URLs are immutable* — cache them, put them behind a CDN. Approving or reverting changes *which* URLs are listed, never what a URL points at.\n" +
          "• *A theme falls back to the default set* rather than returning nothing, so a page never goes blank mid-campaign. `served_theme` tells you which set you actually got.\n" +
          "• *An unknown SKU is `200` with `\"images\": []`* — not a 404. Render the product's own photo.\n" +
          "• *`503` means temporarily unavailable.* Don't cache it: an empty answer cached as \"no images\" is the failure worth avoiding.\n" +
          `• *\`origin\`* is \`ai\` or \`photographer\` (#16), if you ever need to label images.\n` +
          `• Liveness: \`GET ${base}/healthz\` → \`{"ok":true}\`.`,
      },
    },
  ];

  const text = `Endpoints: GET ${base}/products/{SKU}/images`;
  return { text, blocks };
}
