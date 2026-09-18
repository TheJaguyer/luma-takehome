import { z } from "zod";

// Read once at startup; a missing variable fails the process loudly rather than a request later.
const base = z.object({
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("garage"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  LOG_LEVEL: z.string().default("info"),
});

export function loadConfig<T extends z.ZodRawShape>(extra: T) {
  const parsed = base.extend(extra).safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    console.error(`Invalid configuration:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
  return parsed.data;
}

/**
 * A PUBLIC_BASE_URL nobody replaced. Every image URL, the lookup the website calls and the
 * integration message are all built from it, so a deployed box still carrying the Compose default
 * hands the team links that work on exactly one machine — and nothing else goes wrong to say so.
 */
export function isLocalBaseUrl(publicBaseUrl: string) {
  try {
    const { hostname } = new URL(publicBaseUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}
