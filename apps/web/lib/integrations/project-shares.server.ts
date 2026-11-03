import { z } from "zod";
import type { ExportJobPayload } from "@archivemind/shared";
import { decryptToken, encryptToken, parseTokenKey } from "@archivemind/shared/token-crypto";
import {
  encodeShareCursor,
  PROJECT_SHARE_PAGE_SIZE,
  type ProjectShareDownloadStatus,
  type ProjectShareMediaVariant,
  type ProjectSharePage,
  type ProjectShareView,
} from "@/lib/project-share-public";
import { publicationRightsSchema } from "@/lib/publication-shares";
import { shareTokenHash, shareTokenSchema } from "@/lib/share-token";
import { createAdminClient } from "@/lib/supabase/admin";

/** Project share links (ADR 0051) — token custody. A link is looked up by the
 *  SHA-256 of its token; the AES-GCM copy sealed here exists only so an editor
 *  can copy a live link again later. It uses the TOKEN_ENC_KEY Drive and
 *  OneDrive tokens already use, and nothing outside this module touches it. */

function shareTokenKey(): Buffer | null {
  try {
    return parseTokenKey(process.env.TOKEN_ENC_KEY);
  } catch {
    // A link made without a key still works; it just cannot be copied again.
    console.warn("project share: TOKEN_ENC_KEY unavailable, links will not be re-copyable");
    return null;
  }
}

/** The ciphertext to store beside a new link's digest, or null without a key. */
export function sealShareToken(token: string): string | null {
  const key = shareTokenKey();
  return key ? encryptToken(token, key) : null;
}

/** The token back from its ciphertext, or null when it cannot be read: no key,
 *  a rotated key, or a ciphertext that does not authenticate. */
export function openShareToken(ciphertext: string): string | null {
  const key = shareTokenKey();
  if (!key) return null;
  try {
    const token = decryptToken(ciphertext, key);
    return shareTokenSchema.safeParse(token).success ? token : null;
  } catch {
    return null;
  }
}

// ── public surface (/s/*) ────────────────────────────────────────────────
// The resolvers a link's holder reaches, and nothing else: five that read and
// three that write (the upload reservation ledger, ADR 0051 §9). They are
// SECURITY DEFINER functions granted to service_role only (migration
// 20261103000001), so they are called through the admin client behind the
// ESLint fence. Each takes the token's digest, re-runs the one liveness rule
// (project_share_by_token) and answers zero rows for every refusal — which the
// routes turn into one 404, so no answer says WHY a link does not work.

const PUBLIC_RESOLVERS = [
  "open_project_share",
  "list_project_share_assets",
  "resolve_project_share_media",
  "enqueue_project_share_download",
  "project_share_download_status",
  "reserve_project_share_uploads",
  "claim_project_share_uploads",
  "complete_project_share_uploads",
] as const;
type PublicResolver = (typeof PUBLIC_RESOLVERS)[number];

/** The digest of a well-formed token, or null for anything else — a malformed
 *  token never reaches the database. */
async function tokenDigest(token: string): Promise<string | null> {
  return shareTokenSchema.safeParse(token).success ? shareTokenHash(token) : null;
}

function publicResolver(name: PublicResolver, args: Record<string, unknown>) {
  if (!PUBLIC_RESOLVERS.includes(name)) throw new Error(`not a public resolver: ${name}`);
  return createAdminClient().rpc(name, args);
}

const timestampSchema = z.string().datetime({ offset: true });

const openRowSchema = z.object({
  project_name: z.string().min(1).max(500),
  can_download: z.boolean(),
  can_upload: z.boolean(),
  expires_at: timestampSchema,
  rights: publicationRightsSchema,
  file_count: z.number().int().nonnegative().nullable(),
});

/** The page's head: name, rights, byline. Null for every refusal. */
export async function openProjectShare(token: string): Promise<ProjectShareView | null> {
  const digest = await tokenDigest(token);
  if (!digest) return null;
  const { data, error } = await publicResolver("open_project_share", { p_token_hash: digest }).maybeSingle();
  if (error || !data) return null;
  const row = openRowSchema.safeParse(data);
  if (!row.success) return null;
  return {
    projectName: row.data.project_name,
    canDownload: row.data.can_download,
    canUpload: row.data.can_upload,
    expiresAt: row.data.expires_at,
    rights: row.data.rights,
    fileCount: row.data.can_download ? row.data.file_count : null,
  };
}

const assetRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.string().min(1).max(40),
  filename: z.string().min(1).max(500),
  byte_size: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  taken_at: timestampSchema.nullable(),
  has_preview: z.boolean(),
  has_original: z.boolean(),
  sort_at: timestampSchema,
});

/** One page of the project's live files, newest first. Null for every refusal,
 *  an upload-only link included. */
export async function listProjectShareAssets(
  token: string,
  cursor: { sortAt: string; id: string } | null,
): Promise<ProjectSharePage | null> {
  const digest = await tokenDigest(token);
  if (!digest) return null;
  const { data, error } = await publicResolver("list_project_share_assets", {
    p_token_hash: digest,
    p_before_sort_at: cursor?.sortAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: PROJECT_SHARE_PAGE_SIZE,
  });
  if (error || !Array.isArray(data)) return null;
  const rows = z.array(assetRowSchema).max(PROJECT_SHARE_PAGE_SIZE).safeParse(data);
  if (!rows.success) return null;
  // No rows is also how the SQL refuses — a dead link, or one that cannot
  // download — so an empty page has to prove the link still lists files before
  // it may say "no more files" instead of the uniform 404.
  if (rows.data.length === 0) {
    const share = await openProjectShare(token);
    if (!share?.canDownload) return null;
  }
  const last = rows.data.at(-1);
  return {
    files: rows.data.map((row) => ({
      id: row.id,
      kind: row.kind,
      filename: row.filename,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      takenAt: row.taken_at,
      hasPreview: row.has_preview,
      hasOriginal: row.has_original,
    })),
    nextCursor: last && rows.data.length === PROJECT_SHARE_PAGE_SIZE
      ? encodeShareCursor(last.sort_at, last.id)
      : null,
  };
}

const mediaRowSchema = z.object({
  r2_key: z.string().min(1).max(2_000),
  filename: z.string().min(1).max(600),
  mime_type: z.string().min(1).max(200),
  quality: z.enum(["original", "web", "preview"]),
});

export interface ProjectShareMedia {
  key: string;
  filename: string;
  /** original = the stored file; web = a Drive/OneDrive file's 1024px preview
   *  standing in for it; preview = a thumb or medium picture for the page. */
  quality: "original" | "web" | "preview";
}

/** One object key for one request. The resolver has already checked the asset
 *  is live in this link's project and the key sits under its workspace. */
export async function resolveProjectShareMedia(
  token: string,
  assetId: string,
  variant: ProjectShareMediaVariant,
): Promise<ProjectShareMedia | null> {
  const digest = await tokenDigest(token);
  if (!digest || !z.string().uuid().safeParse(assetId).success) return null;
  const { data, error } = await publicResolver("resolve_project_share_media", {
    p_token_hash: digest,
    p_asset_id: assetId,
    p_variant: variant,
  }).maybeSingle();
  if (error || !data) return null;
  const row = mediaRowSchema.safeParse(data);
  if (!row.success) return null;
  return { key: row.data.r2_key, filename: row.data.filename, quality: row.data.quality };
}

const enqueueRowSchema = z.object({ job_id: z.string().uuid(), reused: z.boolean() });

export type EnqueueProjectShareDownload =
  | { ok: true; jobId: string; reused: boolean }
  | { ok: false; reason: "not_found" | "busy" | "limit" | "failed" };

/** Queue a link ZIP. The payload is built by the route with the shared zod
 *  contract; the resolver intersects its ids with the project, applies the
 *  per-link and per-workspace guards and stamps share_id. Its error codes
 *  collapse to four answers — the job's own text never reaches a stranger. */
export async function enqueueProjectShareDownload(
  token: string,
  payload: ExportJobPayload,
): Promise<EnqueueProjectShareDownload> {
  const digest = await tokenDigest(token);
  if (!digest) return { ok: false, reason: "not_found" };
  const { data, error } = await publicResolver("enqueue_project_share_download", {
    p_token_hash: digest,
    p_payload: payload,
  }).maybeSingle();
  if (error) {
    if (error.message === "project_share_download_busy") return { ok: false, reason: "busy" };
    if (error.message === "project_share_download_limit") return { ok: false, reason: "limit" };
    // None of the ids is a live file of this project: as unknown as a bad token.
    if (error.message === "project_share_download_empty") return { ok: false, reason: "not_found" };
    return { ok: false, reason: "failed" };
  }
  if (!data) return { ok: false, reason: "not_found" };
  const row = enqueueRowSchema.safeParse(data);
  return row.success
    ? { ok: true, jobId: row.data.job_id, reused: row.data.reused }
    : { ok: false, reason: "failed" };
}

const statusRowSchema = z.object({
  status: z.enum(["queued", "running", "done", "failed", "canceled"]),
  progress: z.number().int().min(0).max(100).nullable(),
  title: z.string().max(200).nullable(),
  result_key: z.string().min(1).max(2_000).nullable(),
  error: z.enum(["export_too_large", "export_failed"]).nullable(),
});

export interface ProjectShareDownloadJob extends ProjectShareDownloadStatus {
  title: string | null;
  /** The artifact's key once done, and only if it is still this workspace's
   *  export (the resolver checks the prefix); null after the retention sweep. */
  resultKey: string | null;
}

/** A link ZIP this same link asked for; null for any other job. */
export async function projectShareDownloadStatus(
  token: string,
  jobId: string,
): Promise<ProjectShareDownloadJob | null> {
  const digest = await tokenDigest(token);
  if (!digest || !z.string().uuid().safeParse(jobId).success) return null;
  const { data, error } = await publicResolver("project_share_download_status", {
    p_token_hash: digest,
    p_job_id: jobId,
  }).maybeSingle();
  if (error || !data) return null;
  const row = statusRowSchema.safeParse(data);
  if (!row.success) return null;
  return {
    status: row.data.status,
    progress: row.data.progress ?? 0,
    error: row.data.error === "export_too_large" ? "too_large" : row.data.error ? "failed" : null,
    title: row.data.title,
    resultKey: row.data.result_key,
  };
}

// ── anonymous uploads (ADR 0051 §9) ──────────────────────────────────────

/** One file as the reserve RPC takes it: the display name and the key-safe
 *  name are both already sanitised (lib/project-share-uploads). */
export interface ShareUploadItem {
  filename: string;
  keyName: string;
  mime: string;
  bytes: number;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A staging key is exactly `{ws}/incoming/{reservation}` — the only object a
 *  stranger's browser is ever allowed to write. Checked here as well as built
 *  by the SQL, because a presign for anything else would hand out a write on
 *  an original. */
export function isStagingKey(key: string, reservationId: string): boolean {
  return new RegExp(`^${UUID}/incoming/${reservationId}$`).test(key);
}

/** A final key is `{ws}/originals/{reservation}/{name}` in the SAME workspace
 *  as its staging key: the copy may never cross a tenant. */
export function isFinalKeyFor(finalKey: string, stagingKey: string, reservationId: string): boolean {
  const workspace = stagingKey.split("/")[0];
  return (
    isStagingKey(stagingKey, reservationId) &&
    new RegExp(`^${workspace}/originals/${reservationId}/[A-Za-z0-9_.()+ -]{1,200}$`).test(finalKey)
  );
}

const reservedRowSchema = z.object({ id: z.string().uuid(), staging_key: z.string().min(1).max(200) });

export type ReserveProjectShareUploads =
  | { ok: true; slots: { id: string; stagingKey: string }[] }
  | { ok: false; reason: "not_found" | "quota" | "invalid" | "failed" };

/** Reserve room for one batch. The RPC locks the link row and checks the quota
 *  (open reservations count until swept). Zero rows is how it refuses a dead or
 *  download-only link — a real reservation always returns one row per item. */
export async function reserveProjectShareUploads(
  token: string,
  senderName: string | null,
  items: readonly ShareUploadItem[],
): Promise<ReserveProjectShareUploads> {
  const digest = await tokenDigest(token);
  if (!digest) return { ok: false, reason: "not_found" };
  const { data, error } = await publicResolver("reserve_project_share_uploads", {
    p_token_hash: digest,
    p_uploader_name: senderName,
    p_items: items.map((item) => ({
      filename: item.filename,
      key_name: item.keyName,
      mime: item.mime,
      bytes: item.bytes,
    })),
  });
  if (error) {
    if (error.message === "project_share_upload_quota") return { ok: false, reason: "quota" };
    if (error.message === "invalid_project_share_upload") return { ok: false, reason: "invalid" };
    return { ok: false, reason: "failed" };
  }
  if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: "not_found" };
  const rows = z.array(reservedRowSchema).safeParse(data);
  if (!rows.success || rows.data.length !== items.length) return { ok: false, reason: "failed" };
  if (!rows.data.every((row) => isStagingKey(row.staging_key, row.id))) return { ok: false, reason: "failed" };
  return { ok: true, slots: rows.data.map((row) => ({ id: row.id, stagingKey: row.staging_key })) };
}

const claimedRowSchema = z.object({
  id: z.string().uuid(),
  staging_key: z.string().min(1).max(200),
  final_key: z.string().min(1).max(400),
  declared_bytes: z.number().int().positive(),
});

export interface ClaimedShareUpload {
  id: string;
  stagingKey: string;
  finalKey: string;
  declaredBytes: number;
}

/** Take the right to finalize these reservations; exactly one caller wins
 *  each. An EMPTY list is ambiguous on purpose — a dead link, or a retry whose
 *  reservations an earlier request already settled — so the caller must ask
 *  completeProjectShareUploads, which tells the two apart. Null = the call
 *  itself failed. */
export async function claimProjectShareUploads(
  token: string,
  ids: readonly string[],
): Promise<ClaimedShareUpload[] | null> {
  const digest = await tokenDigest(token);
  if (!digest) return [];
  const { data, error } = await publicResolver("claim_project_share_uploads", {
    p_token_hash: digest,
    p_ids: ids,
  });
  if (error || !Array.isArray(data)) return null;
  const rows = z.array(claimedRowSchema).safeParse(data);
  if (!rows.success) return null;
  const asked = new Set(ids);
  // Never let a row this request did not ask for, or a key outside the
  // reservation's own layout, reach the copier.
  if (!rows.data.every((row) => asked.has(row.id) && isFinalKeyFor(row.final_key, row.staging_key, row.id))) {
    return null;
  }
  return rows.data.map((row) => ({
    id: row.id,
    stagingKey: row.staging_key,
    finalKey: row.final_key,
    declaredBytes: row.declared_bytes,
  }));
}

export interface ShareUploadCheck {
  id: string;
  ok: boolean;
  /** What R2 holds at the final key; null when there was nothing to measure. */
  actualBytes: number | null;
}

const completedRowSchema = z.object({ id: z.string().uuid(), status: z.string().min(1).max(40) });

export type CompleteProjectShareUploads =
  | { ok: true; statuses: { id: string; status: string }[] }
  | { ok: false; reason: "not_found" | "failed" };

/** Record what the copier found and turn the good ones into assets plus one
 *  ingest job. Answers every id the browser asked about — including ones an
 *  earlier request settled — so zero rows can only mean a refusal. */
export async function completeProjectShareUploads(
  token: string,
  checks: readonly ShareUploadCheck[],
  ids: readonly string[],
): Promise<CompleteProjectShareUploads> {
  const digest = await tokenDigest(token);
  if (!digest) return { ok: false, reason: "not_found" };
  const { data, error } = await publicResolver("complete_project_share_uploads", {
    p_token_hash: digest,
    p_results: checks.map((check) => ({ id: check.id, ok: check.ok, actual_bytes: check.actualBytes })),
    p_ids: ids,
  });
  if (error) return { ok: false, reason: "failed" };
  if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: "not_found" };
  const rows = z.array(completedRowSchema).safeParse(data);
  if (!rows.success) return { ok: false, reason: "failed" };
  return { ok: true, statuses: rows.data };
}
