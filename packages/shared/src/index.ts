import { z } from "zod";

/**
 * Shared zod schemas + types: domain, job payloads, API contracts, prompt
 * templates (TECH_SPEC §3). Contracts land here as their backend phase starts —
 * migration 0001 (issue #5) brings the domain enums, Phase 1 the upload/job
 * contracts. Consumed as TypeScript source (apps/web has `transpilePackages`).
 */

/** Any Postgres-valid uuid text. zod's .uuid() enforces RFC-4122
 *  version/variant bits and rejects ids Postgres happily stores (fixtures,
 *  imported data) — our contract is "what the uuid column holds". */
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "invalid uuid");

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
  assetIds: z.array(uuidSchema),
  jobId: uuidSchema,
});
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;

/** ai_jobs.payload for type='ingest' (spec §8.1) — produced by the web
 *  complete-route, consumed by the worker handler. */
export const ingestJobPayloadSchema = z.object({
  asset_ids: z.array(uuidSchema).min(1),
});
export type IngestJobPayload = z.infer<typeof ingestJobPayloadSchema>;

// ── Analyze (spec §8.2) — user-triggered via POST /api/jobs ─────────────────

export const analyzeJobPayloadSchema = ingestJobPayloadSchema;
export type AnalyzeJobPayload = IngestJobPayload;

// ── Captions (spec §8.3) ─────────────────────────────────────────────────────

export const captionLangSchema = z.enum(["en", "uk", "ru"]);
export type CaptionLang = z.infer<typeof captionLangSchema>;

export const captionStyleSchema = z.enum(["social", "agency", "archival"]);
export type CaptionStyleKey = z.infer<typeof captionStyleSchema>;

export const captionJobPayloadSchema = z.object({
  asset_ids: z.array(uuidSchema).min(1),
  langs: z.array(captionLangSchema).min(1),
  style: captionStyleSchema,
});
export type CaptionJobPayload = z.infer<typeof captionJobPayloadSchema>;

/** Base prompt templates per style (spec §8.3; packages/shared so web and
 *  worker never drift). `projects.caption_prompt` appends at Phase 5. */
export const CAPTION_PROMPTS: Record<CaptionStyleKey, string> = {
  social:
    "Write a short, punchy social-media caption for this photo: 1-2 sentences, engaging but factual, then 2-4 relevant hashtags. No emoji spam (max 1).",
  agency:
    "Write a wire-agency photo caption: one dense factual paragraph in present tense — who/what/where/when as far as visible or provided. Neutral tone, no speculation, no opinions.",
  archival:
    "Write an archival catalog description: 2-3 objective sentences documenting subjects, setting, composition and any visible text. Dry, precise, suitable for a searchable archive record.",
};

export const CAPTION_LANG_NAMES: Record<CaptionLang, string> = {
  en: "English",
  uk: "Ukrainian",
  ru: "Russian",
};

export const createJobRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("analyze"),
    assetIds: z.array(uuidSchema).min(1).max(500),
  }),
  z.object({
    type: z.literal("caption"),
    assetIds: z.array(uuidSchema).min(1).max(500),
    langs: z.array(captionLangSchema).min(1),
    style: captionStyleSchema,
  }),
]);
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const tagCategorySchema = z.enum(["object", "scene", "place", "attribute", "event", "other"]);
export type TagCategory = z.infer<typeof tagCategorySchema>;

/** Strict shape the analyze model must return (spec §8.2). `.catch` keeps a
 *  single sloppy field from failing a whole batch item. */
export const analyzeOutputSchema = z.object({
  description: z.string().min(1),
  tags: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        category: tagCategorySchema.catch("other"),
        confidence: z.number().min(0).max(1).catch(0.5),
      }),
    )
    .max(32)
    .default([]),
  ocr_text: z.string().default(""),
  suggested_facts: z
    .array(
      z.object({
        text: z.string().min(1).max(500),
        basis: z.enum(["visual", "exif"]).catch("visual"),
      }),
    )
    .max(12)
    .default([]),
});
export type AnalyzeOutput = z.infer<typeof analyzeOutputSchema>;

/** Spec §8.2: person-related output is ATTRIBUTES only — never identity. */
export const ANALYZE_PROMPT = `You are indexing a documentary photographer's archive.
Analyze the image and return strict JSON:
- description: dense factual EN description, 2-4 sentences. No speculation.
- tags: up to 20 short lowercase tags. category one of: object, scene, place, attribute, event, other. "attribute" covers visible person attributes (e.g. "mustache", "military uniform") — NEVER identity, names, or ethnicity.
- ocr_text: text visible in the image, verbatim ("" if none).
- suggested_facts: up to 6 short checkable statements grounded in what is visible (basis "visual") or in provided metadata (basis "exif").`;
