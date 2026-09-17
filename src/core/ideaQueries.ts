import type { Db } from "../lib/db.js";
import type { CardIdea } from "./ideaCards.js";

export async function loadCardIdea(db: Db, ideaId: string): Promise<(CardIdea & { cardChannelId: string | null; cardTs: string | null }) | null> {
  const idea = await db.idea.findUnique({
    where: { id: ideaId },
    include: { options: { orderBy: { position: "asc" } }, product: true, theme: true },
  });
  if (!idea) return null;
  return {
    id: idea.id,
    rawSheetIdea: idea.rawSheetIdea,
    themeName: idea.theme?.name ?? null,
    options: idea.options,
    cardChannelId: idea.cardChannelId,
    cardTs: idea.cardTs,
    product: {
      sku: idea.product.sku,
      name: idea.product.name,
      color: idea.product.color,
      price: idea.product.price,
      notes: idea.product.notes,
      priority: idea.product.priority,
      photoUrl: idea.product.photoUrl,
      hasSourcePhoto: idea.product.currentSourcePhotoId !== null,
    },
  };
}
