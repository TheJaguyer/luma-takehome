// The strict product-preservation rule (#14) is applied here, never shown in the editable idea
// text — an edit changes the scene and cannot delete the rule that keeps the product faithful
// (Flow 2, Step 5).

type ProductFacts = { name: string | null; color: string | null; material: string | null };

export function buildEditPrompt(scene: string, product: ProductFacts, feedback?: string | null) {
  const described = [product.color, product.material, product.name].filter(Boolean).join(" ");
  return [
    `Place the product from the source photo${described ? ` (${described})` : ""} into this scene: ${scene.trim()}`,
    feedback ? `Change from the previous attempt: ${feedback.trim()}` : null,
    "The product must stay exactly as it appears in the source photo: same shape, proportions, " +
      "colour, finish, material, texture, and any markings. Do not restyle, recolour, resize or " +
      "add to the product. Change only the background, surface, props and lighting around it.",
    "Photorealistic commercial product photography, square composition, product clearly visible.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
