import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Worker-side R2 access. Same constraints as the web app's client: the
 *  EU-jurisdiction endpoint (host contains `.eu.`) with path-style addressing
 *  (virtual-hosted PUTs vanish at the edge — verified 2026-07-10). */

let client: S3Client | null = null;

function r2(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are required");
  }
  client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_S3_ENDPOINT ?? `https://${accountId}.eu.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return client;
}

export function r2Bucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET is required");
  return bucket;
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const out = await r2().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }));
  if (!out.Body) throw new Error(`empty body for ${key}`);
  return Buffer.from(await out.Body.transformToByteArray());
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await r2().send(
    new PutObjectCommand({ Bucket: r2Bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }));
}

/** Presigned GET with an explicit TTL — used for export deliverables (ADR 0035),
 *  which need a longer lifetime than the web app's 1 h preview URLs (up to R2's
 *  7-day maximum). Kept worker-side so the web presigner stays short-lived. */
export async function presignGetLong(key: string, ttlSeconds: number): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: r2Bucket(), Key: key }), {
    expiresIn: ttlSeconds,
  });
}
