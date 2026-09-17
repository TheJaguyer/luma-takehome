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
