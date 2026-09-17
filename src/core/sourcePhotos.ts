import sharp, { type Metadata } from "sharp";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Db } from "../lib/db.js";
import { keys, putObject } from "../lib/storage.js";

const MAX_BYTES = 50 * 1024 * 1024; // Luma's source limit

export class PhotoFetchError extends Error {}

/**
 * Fetches a catalogue photo and stores it as the product's next source photo version (#11).
 * "Current" is a pointer, so earlier versions are kept. Throws PhotoFetchError with a reason fit
 * to show the team ("photo URL returned 404").
 */
export async function storeSourcePhotoFromUrl(
  deps: { db: Db; s3: S3Client; bucket: string },
  product: { id: string; sku: string },
  url: string,
  createdBy: string,
) {
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

  let meta: Metadata;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw new PhotoFetchError("photo URL isn't an image");
  }
  const format = meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : "jpg";
  const contentType = format === "jpg" ? "image/jpeg" : `image/${format}`;

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
        originalUrl: url,
        storageKey,
        contentType,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        createdBy,
      },
    });
    await tx.product.update({ where: { id: product.id }, data: { currentSourcePhotoId: photo.id } });
    return photo;
  });
}
