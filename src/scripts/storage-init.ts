// One-shot, idempotent Garage setup, run by Compose before the app services start:
// cluster layout → access key → bucket → public website access → a write/read round trip.
// On the ideal stack this whole script is replaced by a Terraform'd S3 bucket.
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { createLogger } from "../lib/log.js";
import { createStorage } from "../lib/storage.js";

const config = loadConfig({
  GARAGE_ADMIN_URL: z.string().url(),
  GARAGE_ADMIN_TOKEN: z.string().min(1),
});
const log = createLogger("storage-init");

const CAPACITY_BYTES = 20 * 1024 ** 3;

async function admin<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.GARAGE_ADMIN_URL}/v2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.GARAGE_ADMIN_TOKEN}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new AdminError(res.status, `${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function retry<T>(what: string, fn: () => Promise<T>, attempts = 30): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      log.info({ attempt: i, err: String(err) }, `waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

type ClusterStatus = { layoutVersion: number; nodes: { id: string; isUp: boolean; role?: unknown }[] };
type Layout = { version: number; roles: { id: string }[] };
type Bucket = { id: string; websiteAccess: boolean };

async function ensureLayout() {
  const status = await retry("garage admin API", () => admin<ClusterStatus>("GET", "GetClusterStatus"));
  const layout = await admin<Layout>("GET", "GetClusterLayout");
  if (layout.roles.length > 0) {
    log.info({ version: layout.version }, "layout already applied");
    return;
  }
  const node = status.nodes[0];
  if (!node) throw new Error("Garage reports no nodes");
  await admin("POST", "UpdateClusterLayout", {
    roles: [{ id: node.id, zone: "local", capacity: CAPACITY_BYTES, tags: [] }],
  });
  await admin("POST", "ApplyClusterLayout", { version: layout.version + 1 });
  log.info({ node: node.id }, "layout applied");
}

async function ensureKey() {
  try {
    await admin("GET", `GetKeyInfo?id=${encodeURIComponent(config.S3_ACCESS_KEY_ID)}`);
    log.info("access key exists");
  } catch (err) {
    if (!(err instanceof AdminError) || err.status >= 500) throw err;
    await admin("POST", "ImportKey", {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      name: "shots-app",
    });
    log.info("access key imported");
  }
}

async function ensureBucket(): Promise<Bucket> {
  let bucket: Bucket;
  try {
    bucket = await admin<Bucket>("GET", `GetBucketInfo?globalAlias=${encodeURIComponent(config.S3_BUCKET)}`);
    log.info({ bucket: config.S3_BUCKET }, "bucket exists");
  } catch (err) {
    if (!(err instanceof AdminError) || err.status >= 500) throw err;
    bucket = await admin<Bucket>("POST", "CreateBucket", { globalAlias: config.S3_BUCKET });
    log.info({ bucket: config.S3_BUCKET }, "bucket created");
  }

  await admin("POST", "AllowBucketKey", {
    bucketId: bucket.id,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    permissions: { read: true, write: true, owner: true },
  });

  // Website access makes the bucket readable through Garage's web endpoint. Only Caddy reaches
  // that endpoint, and only for images/*, so candidates and source photos stay private.
  if (!bucket.websiteAccess) {
    await admin("POST", `UpdateBucket?id=${encodeURIComponent(bucket.id)}`, {
      websiteAccess: { enabled: true, indexDocument: "index.html" },
    });
    log.info("website access enabled");
  }
  return bucket;
}

async function verifyRoundTrip() {
  const s3 = createStorage(config);
  const Key = "healthcheck/storage-init.txt";
  const Body = `ok ${new Date().toISOString()}`;
  // A freshly applied layout takes a moment to become writable.
  await retry("bucket to accept writes", () =>
    s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key, Body, ContentType: "text/plain" })),
  );
  const got = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key }));
  const text = await got.Body?.transformToString();
  if (text !== Body) throw new Error(`round trip mismatch: wrote "${Body}", read "${text}"`);
  log.info("storage round trip ok");
}

try {
  await ensureLayout();
  await ensureKey();
  await ensureBucket();
  await verifyRoundTrip();
} catch (err) {
  log.error({ err }, "storage init failed");
  process.exit(1);
}
