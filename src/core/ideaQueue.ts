// Which products a drop drafts ideas for — decided when the campaign question is answered, not at
// import, because the answer is what makes the question meaningful. A product is drafted when it
// has no idea yet for the chosen campaign (null = everyday), or its sheet idea changed. So
// re-dropping the catalog and choosing "holiday" starts a holiday run for products that already
// have everyday images — the themed run is its own tracking unit (#3b).
import type { Prisma } from "../generated/prisma/client.js";

export async function queueIdeasForDrop(tx: Prisma.TransactionClient, dropId: string) {
  const drop = await tx.drop.findUniqueOrThrow({ where: { id: dropId }, include: { theme: true } });
  // One team's answers queue one at a time: two imports answered seconds apart must not both
  // decide HG-002 needs a holiday idea.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${drop.teamId}))`;
  const install = await tx.install.findUniqueOrThrow({ where: { teamId: drop.teamId } });
  const entries = await tx.dropProduct.findMany({
    where: { dropId },
    include: { product: { include: { ideas: { where: { state: { not: "SUPERSEDED" } } } } } },
  });

  const data: Prisma.IdeaCreateManyInput[] = [];
  for (const { product, draftIdea: newSheetIdea } of entries) {
    const sheet = product.sheetShotIdea;
    const decision = ideaFor({ ideas: product.ideas, dropId, themeId: drop.themeId, sheet, newSheetIdea });
    if (!decision) continue;
    data.push({
      teamId: drop.teamId,
      productId: product.id,
      dropId,
      themeId: drop.themeId,
      mode: decision,
      rawSheetIdea: sheet,
      // Recorded, so editing the style or theme later doesn't rewrite history (#3b).
      houseStyleUsed: install.houseStyle,
      themeLookUsed: drop.theme?.look ?? null,
    });
  }
  if (data.length) await tx.idea.createMany({ data });
  return data.length;
}

type ExistingIdea = { dropId: string | null; themeId: string | null; mode: string; rawSheetIdea: string | null };

/** null = no idea needed for this drop; otherwise the drafting mode. Pure, so the rules are tested. */
export function ideaFor(p: { ideas: ExistingIdea[]; dropId: string; themeId: string | null; sheet: string | null; newSheetIdea: boolean }): "EXPAND" | "DRAFT" | null {
  if (p.ideas.some((i) => i.dropId === p.dropId)) return null; // already queued by this drop
  const hasForCampaign = p.ideas.some((i) => i.themeId === p.themeId);
  if (hasForCampaign && !p.newSheetIdea) return null;
  // A sheet idea is expanded once. After that, a run for another campaign drafts fresh scenes
  // rather than re-expanding an everyday fragment into a holiday one.
  const expanded = p.sheet !== null && p.ideas.some((i) => i.mode === "EXPAND" && i.rawSheetIdea === p.sheet);
  return p.sheet && !expanded ? "EXPAND" : "DRAFT";
}
