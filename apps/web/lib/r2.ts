import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

/** Presigned GET for serving previews to the browser (zero-egress R2).
 *
 *  `filename` sets ResponseContentDisposition so a download lands with a human
 *  name. It has to be signed into the URL: the `download` attribute on an <a> is
 *  ignored cross-origin, and a presigned URL is on the R2 host, so exports used
 *  to save as a job uuid. Passing it also opts out of the signing-date bucket —
 *  bucketing exists to keep preview URLs byte-identical for the browser cache,
 *  which does not apply to a one-off deliverable. */
export async function presignGet(key: string, filename?: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
    ...(filename ? { ResponseContentDisposition: contentDisposition(filename) } : {}),
  });
  const signingDate = filename
    ? undefined
    : new Date(Math.floor(Date.now() / SIGNING_BUCKET_MS) * SIGNING_BUCKET_MS);
  return getSignedUrl(r2Client(), command, { expiresIn: PRESIGN_GET_TTL_SECONDS, signingDate });
}

export interface R2ObjectStream {
  body: ReadableStream;
  contentLength: number | null;
}

/** Read a private object without ever minting a browser-visible R2 URL.
 * Publication media uses this path so the same-origin route remains the only
 * bearer boundary and revocation is checked on every request. */
export async function streamObject(key: string): Promise<R2ObjectStream> {
  const object = await r2Client().send(new GetObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
  }));
  if (!object.Body) throw new Error("R2 object has no body");
  return {
    body: object.Body.transformToWebStream(),
    contentLength: object.ContentLength ?? null,
  };
}

/** Freeze the currently resolved medium under a share-owned key. The copy
 * makes an already-published preview independent of later non-destructive
 * photo edits; the destination is computed by the trusted creation RPC. */
export async function copyObject(sourceKey: string, destinationKey: string): Promise<void> {
  const bucket = r2Bucket();
  const encodedSource = `${encodeURIComponent(bucket)}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`;
  await r2Client().send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: encodedSource,
    Key: destinationKey,
  }));
}

/** RFC 6266 / 5987 attachment header. A Cyrillic filename cannot go in the plain
 *  `filename=` token, so it also ships percent-encoded in `filename*`, and the
 *  ASCII fallback is stripped rather than mangled. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Delete one object (idempotent — S3 delete of a missing key succeeds). The
 *  only web-side use is the edit-reset cleanup (ADR 0033): two freshly-orphaned
 *  edited previews whose keys are only known in that request. Everything
 *  heavier (asset purge) stays in the worker. */
export async function deleteObject(key: string): Promise<void> {
  await r2Client().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }));
}

/** Object key layout per spec §6: {workspace_id}/originals/{uuid}/{filename}.
 *  The uuid namespaces the object (not the later file-row id); the filename is
 *  sanitized to a safe subset so keys stay portable. */
export function originalKey(workspaceId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 200) || "file";
  return `${workspaceId}/originals/${crypto.randomUUID()}/${safe}`;
}
