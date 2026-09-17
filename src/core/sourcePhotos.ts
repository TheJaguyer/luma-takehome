import sharp, { type Metadata } from "sharp";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Db } from "../lib/db.js";
import { keys, putObject } from "../lib/storage.js";

const MAX_BYTES = 50 * 1024 * 1024; // Luma's source limit

export class PhotoFetchError extends Error {}

type Deps = { db: Db; s3: S3Client; bucket: string };
type ProductRef = { id: string; sku: string };

/** Reads the bytes as an image, or throws a reason fit to show the team. */
function readImage(bytes: Buffer) {
  return sharp(bytes)
    .metadata()
    .then((meta: Metadata) => {
      const format = meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : "jpg";
      return { meta, format, contentType: format === "jpg" ? "image/jpeg" : `image/${format}` };
    })
    .catch(() => {
      throw new PhotoFetchError("that file isn't an image I can read");
    });
}

/**
 * Stores bytes as the product's next source photo version (#11). "Current" is a pointer, so
 * earlier versions are kept and every round records which version produced it.
 *
 * `makeCurrent: false` files the version without pointing at it — Flow 6 confirms the replacement
 * in a second message, and the version is written first so the message can show it. A cancelled
 * replacement leaves an unused version behind, which is consistent with "versions, not
 * overwrites" rather than a leak.
 */
export async function storeSourcePhotoBytes(
  deps: Deps,
  product: ProductRef,
  bytes: Buffer,
  createdBy: string,
  opts: { originalUrl?: string | null; makeCurrent?: boolean } = {},
) {
  const { meta, format, contentType } = await readImage(bytes);

  const latest = await deps.db.sourcePhoto.findFirst({
    where: { productId: product.id },
    orderBy: { version: "desc" },
  });
  const version = (latest?.version ?? 0) + 1;
  const storageKey = keys.sourcePhoto(product.sku, version, format);
  await putObject(deps.s3, deps.bucket, storageKey, bytes, contentType);

  return deps.db.$transaction(async (tx) => {
    const photo = await tx.sourcePhoto.create({
      data: {
        productId: product.id,
        version,
        originalUrl: opts.originalUrl ?? null,
        storageKey,
        contentType,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        createdBy,
      },
    });
    if (opts.makeCurrent !== false) {
      await tx.product.update({ where: { id: product.id }, data: { currentSourcePhotoId: photo.id } });
    }
    return photo;
  });
}

/**
 * Fetches a catalogue photo and stores it as the product's next source photo version.
 * Throws PhotoFetchError with a reason fit to show the team ("photo URL returned 404").
 */
export async function storeSourcePhotoFromUrl(deps: Deps, product: ProductRef, url: string, createdBy: string) {
  let bytes: Buffer;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
    if (!res.ok) throw new PhotoFetchError(`photo URL returned ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new PhotoFetchError("photo is larger than 50 MB");
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof PhotoFetchError) throw err;
    const reason = (err as Error).name === "TimeoutError" ? "timed out" : "couldn't be reached";
    throw new PhotoFetchError(`photo URL ${reason}`);
  }
  try {
    return await storeSourcePhotoBytes(deps, product, bytes, createdBy, { originalUrl: url });
  } catch (err) {
    if (err instanceof PhotoFetchError) throw new PhotoFetchError("photo URL isn't an image");
    throw err;
  }
}

/** Downloads a file someone shared in Slack, using the bot token (private URLs need it). */
export async function fetchSlackFile(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!res.ok) throw new PhotoFetchError(`Slack returned ${res.status} for that file`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new PhotoFetchError("that file is larger than 50 MB");
  return bytes;
}
