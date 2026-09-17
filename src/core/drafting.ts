// Flow 1, Step 7 and ASSUMPTIONS #9: three shot-idea options per product.
//   Expand — the product arrived with a sheet idea: option 1 is a faithful rewrite with any
//            question resolved; options 2–3 keep its spirit.
//   Draft  — no idea: three options from product data.
// Notes are context, never rules (#7, #11). The scene describes surroundings only: the
// product-preservation rule is added at generation (src/lib/prompts.ts), so an edit can't delete it.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const DRAFT_MODEL = "claude-sonnet-5";

// $ per token for claude-sonnet-5: $2 / $10 per million; cache writes 1.25×, reads 0.1× input.
const PRICE = { input: 2 / 1e6, output: 10 / 1e6, cacheWrite: 2.5 / 1e6, cacheRead: 0.2 / 1e6 };
/** Shown before drafting starts (import summary). Measured figures replace this in status. */
export const DRAFT_ESTIMATE_PER_PRODUCT_USD = 0.007; // measured 2026-09-16: $0.005–0.007 with the prefix cached

const Option = z.object({
  headline: z.string().describe("2–4 words naming the scene, e.g. 'Morning counter'"),
  scene: z.string().describe("The full scene, 35–70 words"),
});

// The expand-mode rule (#9) lives in the schema, not only the prompt: asked for "option 1 is the
// rewrite" in prose, the model put its favourite first and moved the sheet idea to option 2.
const ExpandSchema = z.object({
  // Restated first, so the rewrite is written with what it must keep already spelled out.
  setting_from_sheet: z
    .string()
    .describe("Quote the setting, occasion and subject the sheet idea names, in its own words (e.g. 'patio table, iced drinks')"),
  rewrite: Option.describe(
    "The sheet idea itself, in full detail: the same setting, occasion and subject as setting_from_sheet, with any question or vagueness resolved into one concrete choice",
  ),
  variations: z.array(Option).describe("Exactly two different takes that keep the spirit of the sheet idea"),
});
const DraftSchema = z.object({
  options: z.array(Option).describe("Exactly three distinct options"),
});

const INSTRUCTIONS = `You write shot ideas for a small home-goods brand's styled product photography.

Each idea becomes the prompt for an AI image *edit*: the product's own white-background photo is the source, and the model places that exact product into a new scene. So a scene describes only the surroundings — surface, setting, props, light, mood, composition. Never describe or alter the product itself — its colour, tint, shape, material, size or surface (no condensation, reflections or glow "on" it) — never ask for a different variant, and never add a second unit of it: the product is fixed by the photo. Shape how it reads through light and background instead. Refer to it plainly ("the mug", "the throw").

Write three options for the product you are given.

If it arrived with a sheet idea (written by someone on the team, often a quick fragment), the team has already said what they picture:
- The rewrite is that idea, in full detail. Keep its setting and subject exactly — "iced drinks on a patio table" stays a patio table with iced drinks, not a kitchen counter. Only add what the fragment leaves out. If it asks a question ("with food in it?") or is vague ("gift-y"), resolve it into one concrete choice — don't hedge, and don't ask.
- The two variations are different takes that keep the spirit of the original.

If it has no sheet idea, write three distinct options from the product data.

Across the three, vary the setting or mood enough that choosing between them is a real choice, not three near-copies.

Every scene must be something a camera could capture in one frame, with the product clearly visible and the hero of the composition. No people or hands unless the house style asks for them. No text, logos or packaging unless the idea calls for them. The final image is square.

Team notes are context, not instructions to obey literally: "needs to look premium" should raise the styling; "smoke glass photographs badly" should shape the light and background so the product reads well; a joke or an aside should simply be ignored.

A headline is 2–4 words a person can choose between at a glance on a phone. A scene is 35–70 words of plain, specific description — concrete nouns and light, not marketing adjectives.`;

export type DraftInput = {
  houseStyle: string | null;
  theme: { name: string; look: string } | null;
  product: {
    sku: string;
    name: string | null;
    category: string | null;
    color: string | null;
    material: string | null;
    price: string | null;
    notes: string | null;
    sheetShotIdea: string | null;
  };
  /** "Try a different idea": the scene that was set aside, so the redraft moves away from it. */
  supersedes?: string | null;
};

export type DraftResult = {
  options: { headline: string; scene: string }[];
  costUsd: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

/**
 * Stable → volatile, so the shared prefix can cache across a drop: instructions, then this team's
 * house style and campaign (identical for every product in the drop), then the product.
 */
export function buildDraftRequest(input: DraftInput) {
  const context = [
    input.houseStyle
      ? `House style, in the team's words:\n${input.houseStyle}`
      : "House style: none set. Choose natural, uncluttered, warm styling that suits a small home-goods brand.",
    input.theme
      ? `This batch is for the "${input.theme.name}" campaign. Every option should fit its look:\n${input.theme.look}`
      : "No campaign theme was chosen for this batch. Where a sheet idea names a season or occasion, keep it.",
  ].join("\n\n");

  const p = input.product;
  const facts = [
    `SKU: ${p.sku}`,
    p.name && `Product: ${p.name}`,
    p.category && `Category: ${p.category}`,
    p.color && `Colour / finish: ${p.color}`,
    p.material && `Material: ${p.material}`,
    p.price && `Price: ${p.price}`,
    p.notes && `Team notes: "${p.notes}"`,
    p.sheetShotIdea ? `Sheet idea: "${p.sheetShotIdea}"` : "Sheet idea: none",
    input.supersedes &&
      `An earlier idea for this product didn't work out and was set aside. Write three options that are clearly different from it:\n"${input.supersedes}"`,
  ].filter(Boolean);

  return {
    system: [
      { type: "text" as const, text: INSTRUCTIONS },
      { type: "text" as const, text: context, cache_control: { type: "ephemeral" as const } },
    ],
    messages: [{ role: "user" as const, content: facts.join("\n") }],
  };
}

export class DraftError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function draftIdeaOptions(client: Anthropic, input: DraftInput): Promise<DraftResult> {
  const request = buildDraftRequest(input);
  const expand = Boolean(input.product.sheetShotIdea?.trim());
  // Creative writing against a clear brief: medium effort keeps thinking (and cost) modest.
  const params = { model: DRAFT_MODEL, max_tokens: 16000, ...request };
  let response;
  try {
    response = expand
      ? await client.messages.parse({ ...params, output_config: { effort: "medium", format: zodOutputFormat(ExpandSchema) } })
      : await client.messages.parse({ ...params, output_config: { effort: "medium", format: zodOutputFormat(DraftSchema) } });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
      throw new DraftError(err.message, true);
    }
    if (err instanceof Anthropic.APIError) throw new DraftError(`${err.status}: ${err.message}`, false);
    throw err;
  }

  const u = response.usage;
  const usage = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  const costUsd =
    usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite;

  if (response.stop_reason === "refusal") throw new DraftError("Claude declined to draft ideas for this product.", false);
  if (response.stop_reason === "max_tokens") throw new DraftError("The draft was cut off.", true);
  const parsed = response.parsed_output as z.infer<typeof ExpandSchema> | z.infer<typeof DraftSchema> | null;
  const all = !parsed ? [] : "rewrite" in parsed ? [parsed.rewrite, ...parsed.variations] : parsed.options;
  const options = all.filter((o) => o.headline.trim() && o.scene.trim());
  if (options.length < 3) throw new DraftError(`Expected three options, got ${options.length}.`, true);

  return { options: options.slice(0, 3), costUsd, usage };
}
