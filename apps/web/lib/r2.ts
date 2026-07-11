import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** R2 S3 client (server-only). Our buckets carry the EU jurisdiction, whose
 *  S3 endpoint host includes `.eu.` — the plain account endpoint 404s on them.
 *  TTLs per spec §12: 15 min PUT. */

const PRESIGN_PUT_TTL_SECONDS = 15 * 60;

// Module singleton: the client is stateless config + a middleware stack, and a
// 500-asset canvas load presigns hundreds of URLs — constructing one per call
// was pure overhead.
let client: S3Client | null = null;

function r2Client(): S3Client {
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
    // R2 jurisdiction endpoints require path-style addressing — virtual-hosted
    // PUTs return an ETag at the edge but the object never lands in the bucket
    // (verified live 2026-07-10).
    forcePathStyle: true,
  });
  return client;
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

const PRESIGN_GET_TTL_SECONDS = 60 * 60; // spec §12: 1 h GET
/** Signing timestamps are bucketed so the URL for a given key is byte-identical
 *  across page loads within a 30-min window — otherwise every navigation mints
 *  a fresh X-Amz-Date/signature and the browser re-downloads every preview.
 *  Remaining validity is always 30–60 min, inside the spec §12 1 h TTL. */
const SIGNING_BUCKET_MS = 30 * 60 * 1000;

/** Presigned GET for serving previews to the browser (zero-egress R2). */
export async function presignGet(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: r2Bucket(), Key: key });
  const signingDate = new Date(Math.floor(Date.now() / SIGNING_BUCKET_MS) * SIGNING_BUCKET_MS);
  return getSignedUrl(r2Client(), command, { expiresIn: PRESIGN_GET_TTL_SECONDS, signingDate });
}

/** Object key layout per spec §6: {workspace_id}/originals/{uuid}/{filename}.
 *  The uuid namespaces the object (not the later file-row id); the filename is
 *  sanitized to a safe subset so keys stay portable. */
export function originalKey(workspaceId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 200) || "file";
  return `${workspaceId}/originals/${crypto.randomUUID()}/${safe}`;
}
