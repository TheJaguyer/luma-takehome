import { createServer } from "node:http";
import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { createDb } from "../lib/db.js";
import { createLogger } from "../lib/log.js";
import { publicImageUrl } from "../lib/storage.js";

// Flow 7: GET /products/{SKU}/images[?theme=name]. On the site's page-render path, so it is
// built to be boring — a well-formed request never fails, and an unknown SKU is 200 with [].
const config = loadConfig({ PORT: z.coerce.number().default(3001) });
const log = createLogger("lookup");
const db = createDb(config.DATABASE_URL);

const ROUTE = /^\/products\/([^/]+)\/images\/?$/;

async function lookup(sku: string, requestedTheme: string | null) {
  // Single workspace at runtime (REQUIREMENTS, "Install model"): the SKU is enough.
  const images = await db.image.findMany({
    where: { product: { sku }, revokedAt: null },
    include: { theme: true },
    orderBy: [{ sortKey: "asc" }, { approvedAt: "asc" }],
  });

  // Decision 7.2: themed images first, then the defaults. Other themes are not served.
  const themed = requestedTheme ? images.filter((i) => i.theme?.name === requestedTheme) : [];
  const defaults = images.filter((i) => i.themeId === null);
  const served = [...themed, ...defaults];

  return {
    sku,
    requested_theme: requestedTheme,
    served_theme: themed.length > 0 ? requestedTheme : "default",
    images: served.map((image, index) => ({
      url: publicImageUrl(config.PUBLIC_BASE_URL, image.publicKey),
      primary: index === 0,
      theme: image.theme?.name ?? "default",
      origin: image.origin,
      width: image.width,
      height: image.height,
      approved_at: image.approvedAt.toISOString(),
    })),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://lookup");
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/healthz") return send(200, { ok: true });

  const match = req.method === "GET" ? ROUTE.exec(url.pathname) : null;
  if (!match?.[1]) return send(404, { error: "not found" });

  const sku = decodeURIComponent(match[1]);
  const theme = url.searchParams.get("theme")?.trim() || null;
  try {
    send(200, await lookup(sku, theme));
  } catch (err) {
    // A 503 rather than an empty 200: an empty answer would be cached as "no images".
    log.error({ err, sku, theme }, "lookup failed");
    send(503, { error: "temporarily unavailable" });
  }
});

server.listen(config.PORT, () => log.info({ port: config.PORT }, "lookup started"));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => void db.$disconnect().then(() => process.exit(0))));
}
