import sharp, { type OverlayOptions } from "sharp";

// The numbered 2×2 contact sheet (Flow 3, decision 3.1): one screen per product to triage.

const TILE = 800;
const GAP = 12;
const SIZE = TILE * 2 + GAP;

export type Tile = { position: number; image: Buffer | null };

function badge(n: number) {
  return Buffer.from(
    `<svg width="120" height="120" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="46" fill="#111" fill-opacity="0.82"/>
      <text x="60" y="78" font-family="DejaVu Sans, Arial, sans-serif" font-size="52"
        font-weight="700" fill="#fff" text-anchor="middle">${n}</text>
    </svg>`,
  );
}

function missingTile(n: number) {
  return Buffer.from(
    `<svg width="${TILE}" height="${TILE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e7e5e4"/>
      <text x="50%" y="50%" font-family="DejaVu Sans, Arial, sans-serif" font-size="44"
        fill="#57534e" text-anchor="middle">${n} · didn't generate</text>
    </svg>`,
  );
}

export async function buildContactSheet(tiles: Tile[]): Promise<Buffer> {
  const layers: OverlayOptions[] = [];
  for (const tile of tiles) {
    const index = tile.position - 1;
    const left = (index % 2) * (TILE + GAP);
    const top = Math.floor(index / 2) * (TILE + GAP);
    const input = tile.image
      ? await sharp(tile.image).resize(TILE, TILE, { fit: "contain", background: "#ffffff" }).toBuffer()
      : await sharp(missingTile(tile.position)).png().toBuffer();
    layers.push({ input, left, top });
    if (tile.image) layers.push({ input: badge(tile.position), left: left + 16, top: top + 16 });
  }

  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .jpeg({ quality: 85 })
    .toBuffer();
}
