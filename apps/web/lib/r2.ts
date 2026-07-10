import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** R2 S3 client (server-only). Our buckets carry the EU jurisdiction, whose
 *  S3 endpoint host includes `.eu.` — the plain account endpoint 404s on them.
 *  TTLs per spec §12: 15 min PUT. */

const PRESIGN_PUT_TTL_SECONDS = 15 * 60;

function r2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are required");
  }
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_S3_ENDPOINT ?? `https://${accountId}.eu.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // R2 jurisdiction endpoints require path-style addressing — virtual-hosted
    // PUTs return an ETag at the edge but the object never lands in the bucket
    // (verified live 2026-07-10).
    forcePathStyle: true,
  });
}

export function r2Bucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET is required");
  return bucket;
}

/** Presigned PUT for a browser-direct upload. Content-Type is part of the
 *  signature, so the browser must send exactly the MIME it declared. */
export async function presignPut(key: string, mime: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
    ContentType: mime,
  });
  return getSignedUrl(r2Client(), command, { expiresIn: PRESIGN_PUT_TTL_SECONDS });
}

/** Object key layout per spec §6: {workspace_id}/originals/{uuid}/{filename}.
 *  The uuid namespaces the object (not the later file-row id); the filename is
 *  sanitized to a safe subset so keys stay portable. */
export function originalKey(workspaceId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 200) || "file";
  return `${workspaceId}/originals/${crypto.randomUUID()}/${safe}`;
}
