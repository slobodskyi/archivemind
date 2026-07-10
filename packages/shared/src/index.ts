import { z } from "zod";

/**
 * Shared zod schemas + types: domain, job payloads, API contracts, prompt
 * templates (TECH_SPEC §3). Contracts land here as their backend phase starts —
 * migration 0001 (issue #5) brings the domain enums, Phase 1 the upload/job
 * contracts. Consumed as TypeScript source (apps/web has `transpilePackages`).
 */

// Seed: workspace roles per TECH_SPEC §4 `member_role` — referenced by both
// the web app (membership UI) and the worker (nothing yet).
export const memberRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type MemberRole = z.infer<typeof memberRoleSchema>;

// Job queue contracts per TECH_SPEC §4 `job_type` / `job_status` — the wire
// format between web (enqueue via POST /api/jobs) and the worker (claim loop).
export const jobTypeSchema = z.enum(["ingest", "analyze", "caption", "export"]);
export type JobType = z.infer<typeof jobTypeSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "done", "failed", "canceled"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

// ── Upload path (TECH_SPEC §6, §9) — web routes ↔ browser, later the worker ──

export const assetKindSchema = z.enum(["photo", "pdf", "document", "other"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

/** §4 asset_kind from a MIME type — shared so ingest (worker) classifies
 *  identically to the upload route (web). */
export function assetKindFromMime(mime: string): AssetKind {
  if (mime.startsWith("image/")) return "photo";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.startsWith("text/") ||
    mime === "application/msword" ||
    mime.endsWith("wordprocessingml.document") ||
    mime === "application/rtf"
  ) {
    return "document";
  }
  return "other";
}

/** Single presigned PUT covers ≤ 100 MiB (spec §6); fixed-size multipart for
 *  larger files is a Phase-1 follow-up — the schema caps at the single-PUT
 *  limit so the UI gets a clean error instead of a broken upload. */
export const SINGLE_PUT_MAX_BYTES = 100 * 1024 * 1024;

export const presignUploadRequestSchema = z.object({
  filename: z.string().min(1).max(512),
  mime: z.string().min(1).max(255),
  size: z.number().int().positive().max(SINGLE_PUT_MAX_BYTES),
});
export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>;

export const presignUploadResponseSchema = z.object({
  uploadUrl: z.string().url(),
  r2Key: z.string().min(1),
});
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;

export const completeUploadRequestSchema = z.object({
  uploads: z
    .array(
      z.object({
        r2Key: z.string().min(1),
        filename: z.string().min(1).max(512),
        mime: z.string().min(1).max(255),
        size: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

export const completeUploadResponseSchema = z.object({
  assetIds: z.array(z.string().uuid()),
  jobId: z.string().uuid(),
});
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;
