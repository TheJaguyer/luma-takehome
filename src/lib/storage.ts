import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type StorageConfig = {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
};

// The S3 API is the interface: Garage today, S3 later, by changing these variables only.
export function createStorage(config: StorageConfig) {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    // Newer SDKs add CRC checksums to every request by default; S3-compatible stores vary in
    // support, and AWS S3 accepts either.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Approved images live under images/ — the only prefix Caddy routes publicly. */
export const keys = {
  approvedImage: (sku: string, imageId: string) => `images/${sku}/${imageId}.jpg`,
  sourcePhoto: (sku: string, version: number, ext: string) => `sources/${sku}/v${version}.${ext}`,
  candidate: (roundId: string, position: number) => `candidates/${roundId}/${position}.jpg`,
  contactSheet: (roundId: string) => `sheets/${roundId}.jpg`,
};

export function publicImageUrl(publicBaseUrl: string, key: string) {
  return `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
}

export async function putObject(s3: S3Client, bucket: string, key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObjectBytes(s3: S3Client, bucket: string, key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`empty object: ${key}`);
  return Buffer.from(await res.Body.transformToByteArray());
}
