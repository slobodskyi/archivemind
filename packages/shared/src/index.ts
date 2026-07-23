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
// `cluster` (ADR 0028) is worker-only: enqueued at the tail of analyze, never
// via POST /api/jobs (deliberately absent from createJobRequestSchema).
// `edit` (ADR 0030) is enqueued by the dedicated POST /api/assets/[id]/edit
// route (not POST /api/jobs) — the worker renders the edited previews.
// `purge` (ADR 0033) is enqueued by the DB sweep (sweep_deleted_assets) and by
// POST /api/assets/purge ("Delete permanently") — the worker erases R2 bytes +
// DB derivatives of expired trash, keeping the asset row as a dedup tombstone.
export const jobTypeSchema = z.enum(["ingest", "analyze", "caption", "export", "cluster", "edit", "purge"]);
export type JobType = z.infer<typeof jobTypeSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "done", "failed", "canceled"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

// ── Dropbox import (ADR 0008: Chooser direct links, no OAuth; #24) ───────────

/** SSRF gate for Chooser direct links, shared by the imports route (parse
 *  time) and the worker (fetch time, defense in depth): the link is fed to a
 *  server-side fetch, so ONLY Dropbox's direct-content host is acceptable —
 *  https, no credentials, no port games. Exported for tests + the worker. */
export function isDropboxDirectLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    (url.hostname === "dl.dropboxusercontent.com" ||
      url.hostname.endsWith(".dl.dropboxusercontent.com"))
  );
}

export const dropboxDirectLinkSchema = z
  .string()
  .max(2048)
  .refine(isDropboxDirectLink, "not a Dropbox direct link");

/** One picked Chooser file. `sourceId` is Chooser's stable file id — the
 *  dedupe key (never interpolated into any URL; the link is what gets
 *  fetched, and it expires after ~4 h). */
/** Chooser returns no MIME type — infer from the extension so asset kind,
 *  files.mime_type and the worker's decode routing behave like uploads.
 *  Unknown extensions fall to octet-stream (RAW decode keys off the FILENAME,
 *  so NEF/CR2/… still route correctly). */
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
  heic: "image/heic", heif: "image/heif", bmp: "image/bmp", pdf: "application/pdf",
};
export function mimeFromFilename(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

export const dropboxImportItemSchema = z.object({
  sourceId: z.string().min(1).max(256),
  name: z.string().trim().min(1).max(512),
  link: dropboxDirectLinkSchema,
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type DropboxImportItem = z.infer<typeof dropboxImportItemSchema>;

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
 *  complete/imports routes, consumed by the worker handler.
 *
 *  `dropbox` (#24, ADR 0008): Chooser direct links live ~4 h and cannot be
 *  re-minted, so they ride in the job payload (broadcast reaches workspace
 *  members only — the same people who will see the photos) and the worker
 *  fetches each once into R2. A retry after expiry per-file-fails with
 *  `dropbox_link_expired`; a re-pick brings a fresh link in a fresh job. */
export const ingestJobPayloadSchema = z.object({
  asset_ids: z.array(uuidSchema).min(1),
  dropbox: z
    .array(
      z.object({
        asset_id: uuidSchema,
        link: dropboxDirectLinkSchema,
        name: z.string().min(1).max(512),
      }),
    )
    .optional(),
});
export type IngestJobPayload = z.infer<typeof ingestJobPayloadSchema>;

// ── Analyze (spec §8.2) — user-triggered via POST /api/jobs ─────────────────

export const analyzeJobPayloadSchema = ingestJobPayloadSchema;
export type AnalyzeJobPayload = IngestJobPayload;

// ── Cluster (spec §10/§13; ADR 0028) — worker-only, enqueued after analyze ───

/** ai_jobs.payload for type='cluster'. Workspace-scoped, not asset-scoped: the
 *  job re-clusters every analyzed asset in the workspace so topics stay stable
 *  across sessions and identical in every project. No web enqueue path exists
 *  (the tag heuristic in lib/topics.ts covers the un-clustered window), so this
 *  is only ever produced by the worker's analyze tail. */
export const clusterJobPayloadSchema = z.object({
  workspace_id: uuidSchema,
});
export type ClusterJobPayload = z.infer<typeof clusterJobPayloadSchema>;

// ── Purge (ADR 0033) — trash retention's second half ─────────────────────────

/** ai_jobs.payload for type='purge'. Enqueued by sweep_deleted_assets() (one
 *  job per workspace per run) and by POST /api/assets/purge ("Delete
 *  permanently" / "Empty trash"). The worker deletes the R2 objects FIRST
 *  (originals, previews, edited previews — while the rows still map the keys),
 *  then the derivative rows, then stamps assets.purged_at. The asset row
 *  itself survives as a tombstone (ADR 0032 dedup reactivation), but its
 *  files.content_hash/r2_key are cleared so it never again claims a hash. */
export const purgeJobPayloadSchema = z.object({
  asset_ids: z.array(uuidSchema).min(1),
});
export type PurgeJobPayload = z.infer<typeof purgeJobPayloadSchema>;

// ── Asset trash ops (ADR 0033) — bulk delete / restore / purge ───────────────

/** POST /api/assets/delete | /restore | /purge. Bulk-first: multi-select
 *  delete used to fan out N single-id DELETE calls; one request now moves the
 *  whole selection (and the undo toast restores it with one call too). Same
 *  500 cap as uploads/imports. */
export const assetIdsRequestSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(500),
});
export type AssetIdsRequest = z.infer<typeof assetIdsRequestSchema>;

/** One row of GET /api/assets?scope=trash — the photo half of the Trash view.
 *  `thumb` is a presigned preview URL (null when previews never rendered);
 *  `deletedAt` drives the "N days left" countdown client-side. Purged
 *  tombstones are excluded server-side — nothing restorable, nothing shown. */
export const trashedAssetSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  thumb: z.string().nullable(),
  deletedAt: z.string().nullable(),
});
export type TrashedAsset = z.infer<typeof trashedAssetSchema>;

export const trashedAssetsResponseSchema = z.object({
  assets: z.array(trashedAssetSchema),
});
export type TrashedAssetsResponse = z.infer<typeof trashedAssetsResponseSchema>;

/** Trash retention window (days) — mirrors the SQL default in
 *  sweep_trashed_projects / sweep_deleted_assets (the DB default is the source
 *  of truth; this constant only feeds UI copy + the countdown). */
export const TRASH_RETENTION_DAYS = 30;

// ── Captions (spec §8.3) — worker handler #13; API wiring joins with #14 ─────

export const captionLangSchema = z.enum(["en", "uk", "ru"]);
export type CaptionLang = z.infer<typeof captionLangSchema>;

export const captionStyleSchema = z.enum(["social", "agency", "archival"]);
export type CaptionStyleKey = z.infer<typeof captionStyleSchema>;

export const captionJobPayloadSchema = z.object({
  asset_ids: z.array(uuidSchema).min(1),
  // dedupe: every duplicate lang would be a paid Gemini call + a billed usage row
  langs: z
    .array(captionLangSchema)
    .min(1)
    .transform((l) => [...new Set(l)]),
  style: captionStyleSchema,
});
export type CaptionJobPayload = z.infer<typeof captionJobPayloadSchema>;

/** Base prompt templates per style (spec §8.3; packages/shared so web and
 *  worker never drift). `projects.caption_prompt` joins once the job payload
 *  carries project context (#14 — a caption job is asset-scoped and assets are
 *  M:N across projects, so the trigger must say which project's tone applies). */
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

/** PATCH /api/captions/[id] — a user edit stamps is_edited=true (the worker
 *  then skips that unit); resetEdited=true clears the flag so a confirmed
 *  regenerate can overwrite. Exactly one of the two per request. */
export const patchCaptionRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    resetEdited: z.literal(true).optional(),
  })
  .refine((v) => (v.text !== undefined) !== (v.resetEdited !== undefined), {
    message: "exactly one of text, resetEdited is required",
  });
export type PatchCaptionRequest = z.infer<typeof patchCaptionRequestSchema>;

/** POST /api/jobs — the user-triggered AI entry point (analyze #12, caption
 *  #14, ingest re-runs #23; export joins with its phase). The ingest variant
 *  exists to heal Drive-linked assets whose download failed or whose
 *  connection was revoked mid-import — the worker's resume guard skips
 *  already-complete files, so re-enqueueing is cheap and idempotent. */
export const createJobRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("analyze"),
    assetIds: z.array(uuidSchema).min(1).max(500),
  }),
  z.object({
    type: z.literal("ingest"),
    assetIds: z.array(uuidSchema).min(1).max(500),
  }),
  z.object({
    type: z.literal("caption"),
    assetIds: z.array(uuidSchema).min(1).max(500),
    // dedupe mirrors captionJobPayloadSchema: dupes = paid calls + billed rows
    langs: z
      .array(captionLangSchema)
      .min(1)
      .transform((l) => [...new Set(l)]),
    style: captionStyleSchema,
  }),
]);
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

// ── Drive import (spec §9 POST /api/imports; ADR 0025; issue #23) ────────────

/** Real Drive file ids are URL-safe [A-Za-z0-9_-]. The regex is load-bearing,
 *  not cosmetic: the id is later interpolated into a Bearer-authorized Drive
 *  URL server-side, so a permissive string like `../files?q=…` would redirect
 *  that GET to other Drive endpoints under the connection owner's token. */
export const driveFileIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,256}$/, "invalid Drive file id");

/** One picked Picker doc. The Picker returns id/name/mimeType/sizeBytes only —
 *  md5Checksum/imageMediaMetadata are NOT available client-side; the worker
 *  fetches them itself via files.get. */
export const importItemSchema = z.object({
  fileId: driveFileIdSchema,
  name: z.string().trim().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type ImportItem = z.infer<typeof importItemSchema>;

/** POST /api/imports — the client chunks picked docs to ≤500 per request
 *  (same cap as completeUploadRequestSchema; one ingest job per request).
 *  gdrive needs the caller's personal connection (worker re-reads via its
 *  refresh token); dropbox is connection-less (ADR 0008) — the ~4 h direct
 *  links themselves are the credential and ride into the job payload. */
export const importRequestSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("gdrive"),
    connectionId: uuidSchema,
    projectId: uuidSchema.optional(), // link via project_assets, like uploads
    items: z.array(importItemSchema).min(1).max(500),
  }),
  z.object({
    provider: z.literal("dropbox"),
    projectId: uuidSchema.optional(),
    items: z.array(dropboxImportItemSchema).min(1).max(500),
  }),
]);
export type ImportRequest = z.infer<typeof importRequestSchema>;

/** POST /api/integrations/google/connect — the popup code flow's server half.
 *  Google authorization codes are opaque; cap length, nothing more. */
export const googleConnectRequestSchema = z.object({
  code: z.string().min(1).max(4096),
});
export type GoogleConnectRequest = z.infer<typeof googleConnectRequestSchema>;

/** GET /api/integrations/google — connection status for the sources modal
 *  and the ImportModal Drive pane (the id feeds POST /api/imports). Errors
 *  travel as first-party codes ({ error: string }), never this shape. */
export const googleConnectionStatusSchema = z.object({
  connected: z.boolean(),
  email: z.string().nullable(),
  connectionId: uuidSchema.nullish(),
});
export type GoogleConnectionStatus = z.infer<typeof googleConnectionStatusSchema>;

export const importResponseSchema = z.object({
  /** newly created assets (order not guaranteed to match items) */
  assetIds: z.array(uuidSchema),
  /** the enqueued ingest job — null when every item was a duplicate */
  jobId: uuidSchema.nullable(),
  /** re-picks of an already-imported (connection, source_file_id) pair… */
  skippedDuplicates: z.number().int().nonnegative(),
  /** …of which, when projectId was given, this many existing assets were
   *  linked to the project instead of silently skipped (M:N, ADR 0011) */
  linkedExisting: z.number().int().nonnegative(),
});
export type ImportResponse = z.infer<typeof importResponseSchema>;

// ── Projects (spec §9; issue #17) — homepage CRUD + M:N asset membership ─────

export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const createProjectResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
});
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>;

/** PATCH /api/projects/[id]: rename and/or move between active/archived/trash.
 *  At least one field must be present. */
export const patchProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    archived: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.archived !== undefined || v.deleted !== undefined, {
    message: "at least one of name, archived, deleted is required",
  });
export type PatchProjectRequest = z.infer<typeof patchProjectRequestSchema>;

export const addProjectAssetsRequestSchema = z.object({
  assetIds: z.array(uuidSchema).min(1).max(500),
});
export type AddProjectAssetsRequest = z.infer<typeof addProjectAssetsRequestSchema>;

// ── Canvas groups: folders + artboards (ADR 0034) ────────────────────────────
//
// One server model, two behaviours. MEMBERSHIP + name + order + settings are
// data (these contracts + the canvas_groups/canvas_group_assets tables); the
// on-canvas geometry stays a per-user client override (ADR 0022 holds).
//   • folder   — organize; a file lives in at most one folder per scope.
//   • artboard — compose a PDF deliverable; ordered members = the pages.

export const canvasGroupKindSchema = z.enum(["folder", "artboard"]);
export type CanvasGroupKind = z.infer<typeof canvasGroupKindSchema>;

/** PDF export config, stored in canvas_groups.settings for artboards ({} for
 *  folders) and echoed in the export job payload. All fields default so an
 *  older client / a folder row parses cleanly. */
export const pageLayoutSchema = z.enum(["one_per_page", "grid"]);
export type PageLayout = z.infer<typeof pageLayoutSchema>;
export const pageSizeSchema = z.enum(["A4", "Letter"]);
export const pageOrientationSchema = z.enum(["portrait", "landscape"]);

export const artboardSettingsSchema = z.object({
  pageLayout: pageLayoutSchema.default("one_per_page"),
  pageSize: pageSizeSchema.default("A4"),
  orientation: pageOrientationSchema.default("portrait"),
  captionLang: captionLangSchema.default("en"),
  captionStyle: captionStyleSchema.default("agency"),
  // Explicit literal default: a bare .default({}) would be used as-is (zod does
  // not re-parse the default), leaving the inner booleans undefined.
  include: z
    .object({
      caption: z.boolean().default(true),
      title: z.boolean().default(true),
      facts: z.boolean().default(false),
      exif: z.boolean().default(false),
    })
    .default({ caption: true, title: true, facts: false, exif: false }),
});
export type ArtboardSettings = z.infer<typeof artboardSettingsSchema>;

/** POST /api/canvas-groups. `assetIds` seeds membership; for a folder the route
 *  also removes those assets from any other folder in the same scope
 *  (single-membership, enforced in the route, not the DB). */
export const createCanvasGroupRequestSchema = z.object({
  kind: canvasGroupKindSchema,
  name: z.string().trim().min(1).max(80),
  projectId: uuidSchema.nullish(), // null/absent = the 'all' canvas
  assetIds: z.array(uuidSchema).max(500).default([]),
  settings: artboardSettingsSchema.optional(),
});
export type CreateCanvasGroupRequest = z.infer<typeof createCanvasGroupRequestSchema>;

/** PATCH /api/canvas-groups/[id] — rename / reorder (artboards) / retune export
 *  settings. At least one field must be present. */
export const patchCanvasGroupRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sortIndex: z.number().int().optional(),
    settings: artboardSettingsSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.sortIndex !== undefined || v.settings !== undefined, {
    message: "at least one of name, sortIndex, settings is required",
  });
export type PatchCanvasGroupRequest = z.infer<typeof patchCanvasGroupRequestSchema>;

/** POST | DELETE /api/canvas-groups/[id]/assets — add / remove members. New
 *  members append after the current max position; folder-exclusivity is applied
 *  server-side on add. */
export const groupAssetsRequestSchema = z.object({
  assetIds: z.array(uuidSchema).min(1).max(500),
});
export type GroupAssetsRequest = z.infer<typeof groupAssetsRequestSchema>;

/** GET /api/canvas-groups?project= — the read shape the canvas hydrates from.
 *  `members` are asset ids ordered by canvas_group_assets.position; `settings`
 *  is the parsed artboard config (null for folders). */
export const canvasGroupSchema = z.object({
  id: uuidSchema,
  kind: canvasGroupKindSchema,
  name: z.string(),
  projectId: uuidSchema.nullable(),
  sortIndex: z.number().int(),
  settings: artboardSettingsSchema.nullable(),
  members: z.array(uuidSchema),
});
export type CanvasGroup = z.infer<typeof canvasGroupSchema>;

export const canvasGroupsResponseSchema = z.object({
  groups: z.array(canvasGroupSchema),
});
export type CanvasGroupsResponse = z.infer<typeof canvasGroupsResponseSchema>;

// ── Artboard PDF export (ADR 0035) — POST /api/exports → ai_jobs type='export' ─
//
// Not routed through POST /api/jobs (like edit/purge, export gets its own
// route). The worker reads the ordered members, renders a PDF (photo + caption
// under each), writes it to R2 `{workspace_id}/exports/{job_id}.pdf`, and puts a
// long-lived presigned URL in ai_jobs.payload.result_url. The type='export'
// value has been in the job_type enum since init.

/** R2 max presign lifetime — export deliverables outlive the 1 h preview TTL. */
export const EXPORT_PRESIGN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** POST /api/exports body — export a saved artboard (`groupId`) or an ad-hoc
 *  selection (`assetIds`). Exactly one source is required. */
export const createExportRequestSchema = z
  .object({
    groupId: uuidSchema.optional(),
    assetIds: z.array(uuidSchema).min(1).max(500).optional(),
    options: artboardSettingsSchema,
  })
  .refine((v) => v.groupId !== undefined || (v.assetIds !== undefined && v.assetIds.length > 0), {
    message: "one of groupId, assetIds is required",
  });
export type CreateExportRequest = z.infer<typeof createExportRequestSchema>;

export const createExportResponseSchema = z.object({ jobId: uuidSchema });
export type CreateExportResponse = z.infer<typeof createExportResponseSchema>;

/** ai_jobs.payload for type='export' (worker handler). Mirrors the request but
 *  in snake_case queue convention, and after the route has resolved a groupId
 *  to its member asset_ids (or passed the selection through). */
export const exportJobPayloadSchema = z
  .object({
    group_id: uuidSchema.optional(),
    asset_ids: z.array(uuidSchema).min(1).max(500).optional(),
    options: artboardSettingsSchema,
    /** written back by the worker when the PDF lands in R2 */
    result_url: z.string().optional(),
  })
  .refine((v) => v.group_id !== undefined || (v.asset_ids !== undefined && v.asset_ids.length > 0), {
    message: "one of group_id, asset_ids is required",
  });
export type ExportJobPayload = z.infer<typeof exportJobPayloadSchema>;

/** GET /api/exports?jobId= — poll/lookup after Realtime signals 'done'. */
export const exportResultSchema = z.object({
  jobId: uuidSchema,
  status: jobStatusSchema,
  url: z.string().nullable(),
});
export type ExportResult = z.infer<typeof exportResultSchema>;

/** One caption row as the DB stores it (lowercase enums), for resolveCaptionText. */
export interface CaptionRowLike {
  lang: CaptionLang;
  style: CaptionStyleKey;
  text: string;
}

/** Pick the caption text for (lang, style) with graceful fallback: exact →
 *  English of the same style → any style in the requested lang → any English →
 *  "". Shared so the PDF export (worker) and the drawer (web) never disagree on
 *  which text a photo shows. */
export function resolveCaptionText(
  rows: CaptionRowLike[],
  lang: CaptionLang,
  style: CaptionStyleKey,
): string {
  const pick = (l: CaptionLang, s: CaptionStyleKey): string | undefined =>
    rows.find((r) => r.lang === l && r.style === s)?.text;
  return (
    pick(lang, style) ??
    pick("en", style) ??
    rows.find((r) => r.lang === lang)?.text ??
    rows.find((r) => r.lang === "en")?.text ??
    ""
  );
}

// ── Search (spec §8.4; issue #15) — GET /api/search ──────────────────────────

/** Gemini's structured parse of a free-text archive query. Every field is
 *  .catch()-guarded: a sloppy model answer degrades to "just semantic search",
 *  never a 500. `kinds` is parsed but unused until non-photo assets ship. */
export const searchParseSchema = z.object({
  semantic_text: z.string().catch(""),
  date_from: z.string().nullish().catch(null),
  date_to: z.string().nullish().catch(null),
  place_terms: z.array(z.string()).catch([]),
  tag_terms: z.array(z.string()).catch([]),
  // EXIF filters (ADR 0031). Nullable numbers/strings degrade to "no filter".
  camera_terms: z.array(z.string()).catch([]),
  iso_min: z.number().nullish().catch(null),
  iso_max: z.number().nullish().catch(null),
  aperture: z.string().nullish().catch(null),
  kinds: z.array(assetKindSchema).catch([]),
});
export type SearchParse = z.infer<typeof searchParseSchema>;

export const SEARCH_PARSE_PROMPT = `You translate a photo-archive search query into structured filters.
Return JSON only. Fields:
- semantic_text: what to match visually/semantically, reworded as a dense noun phrase (keep the query's language). Empty string if the query is pure filters. This text is ALSO matched literally against each photo's AI description and facts, so keep the salient nouns.
- date_from / date_to: ISO dates (YYYY-MM-DD) when the query names a period ("last June", "2026", "18.06"), else null. Resolve relative periods against today's date given below.
- place_terms: place names mentioned (city/country/venue), lowercase, in both the query's language and English if obvious.
- tag_terms: concrete nouns worth matching against tags (objects/scenes/events), lowercase English singular. For each concept also include 1-2 common synonyms or near-variants ("dog" -> dog, puppy; "girl" -> girl, woman). At most 6 terms total.
- camera_terms: camera make/model or lens named in the query ("iphone 13 pro", "sony a7", "50mm"), lowercase. Else [].
- iso_min / iso_max: ISO bounds only when implied. Explicit ("iso 320") sets both. Vague: "high iso" or "night/low-light" -> iso_min 1600; "low iso"/"bright daylight" -> iso_max 400. Else null.
- aperture: an f-number when the query names one ("f/1.5", "wide open" -> "f/1.8", "shot at 2.8" -> "f/2.8"), as it appears in EXIF (e.g. "f/1.5"). Else null.
- kinds: subset of ["photo","pdf","document","other"] only when the query names a type.
Never invent filters the query does not state.`;

/** Relevance tier for one search hit (ADR 0029). "strong" = it matched an
 *  explicit query term (tag/place) or sits within the top cosine band;
 *  "weak" = ranked but distant — the UI shows these collapsed, so a 5-photo
 *  archive stops answering every query with all 5 photos. */
export const searchTierSchema = z.enum(["strong", "weak"]);
export type SearchTier = z.infer<typeof searchTierSchema>;

export const searchResultSchema = z.object({
  assetId: uuidSchema,
  similarity: z.number(),
  tier: searchTierSchema,
  matchedTags: z.array(z.string()),
  matchedPlace: z.string().nullable(),
  /** The query's text hit this asset's AI description or facts (ADR 0031) —
   *  an explicit match, so it counts toward the strong tier like a tag does. */
  matchedText: z.boolean(),
  takenAt: z.string().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  parsed: searchParseSchema,
  results: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

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

// ── Image editing (ADR 0030) — Tier 0 geometry ───────────────────────────────
//
// A NON-DESTRUCTIVE recipe. The stored source of truth is this resolution-
// independent recipe (asset_edits.recipe); the worker renders edited previews
// from the ORIGINAL medium preview (in R2 for every source — upload/gdrive/
// dropbox alike), so editing needs NO original bytes and NO source-specific
// path, and asset_previews (the originals) are never overwritten. Reset =
// dropping the recipe row → instant revert.
//
// The recipe is applied to the EXIF-oriented image in a FIXED order that the
// web preview (CSS transforms) and the worker (sharp) both honour, so the two
// stay pixel-consistent: flip → rotate90 → straighten → crop.

/** Fine-rotation clamp for the straighten slider (degrees, clockwise). */
export const EDIT_STRAIGHTEN_MAX_DEG = 45;

/** Crop rectangle, normalized [0,1] within the WORKING image (i.e. after
 *  flip + rotate90 + straighten). A small epsilon absorbs float slop from the
 *  browser's overlay math. */
export const editCropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  })
  .refine((c) => c.w > 0 && c.h > 0 && c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001, {
    message: "crop out of bounds",
  });
export type EditCrop = z.infer<typeof editCropSchema>;

export const editRecipeSchema = z.object({
  /** Clockwise quarter-turns. */
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  /** Mirror left↔right. */
  flipH: z.boolean().default(false),
  /** Mirror top↔bottom. */
  flipV: z.boolean().default(false),
  /** Fine clockwise rotation in degrees, [-45, 45]. */
  straighten: z.number().min(-EDIT_STRAIGHTEN_MAX_DEG).max(EDIT_STRAIGHTEN_MAX_DEG).default(0),
  /** Null = keep the whole (straightened) frame. */
  crop: editCropSchema.nullable().default(null),
});
export type EditRecipe = z.infer<typeof editRecipeSchema>;

/** POST /api/assets/[id]/edit body. */
export const editAssetRequestSchema = z.object({ recipe: editRecipeSchema });
export type EditAssetRequest = z.infer<typeof editAssetRequestSchema>;

/** ai_jobs.payload for type='edit' (single asset). */
export const editJobPayloadSchema = z.object({
  asset_id: uuidSchema,
  recipe: editRecipeSchema,
});
export type EditJobPayload = z.infer<typeof editJobPayloadSchema>;

/** A recipe that changes nothing — the UI should refuse to enqueue it. */
export function isIdentityRecipe(r: EditRecipe): boolean {
  return r.rotate === 0 && !r.flipH && !r.flipV && r.straighten === 0 && r.crop === null;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Dimensions of the WORKING image (the frame the crop is normalized against):
 *  the EXIF-oriented `w`×`h`, after rotate90 (swaps axes on a quarter-turn) and
 *  straighten (grows the bounding box to hold the tilted content). Flip never
 *  changes size. Pure — the web layout and the worker's fallback both call it. */
export function workingDimensions(
  w: number,
  h: number,
  recipe: Pick<EditRecipe, "rotate" | "straighten">,
): { w: number; h: number } {
  const quarterSwaps = recipe.rotate === 90 || recipe.rotate === 270;
  const w1 = quarterSwaps ? h : w;
  const h1 = quarterSwaps ? w : h;
  if (!recipe.straighten) return { w: w1, h: h1 };
  const a = toRad(recipe.straighten);
  const sin = Math.abs(Math.sin(a));
  const cos = Math.abs(Math.cos(a));
  return {
    w: Math.round(w1 * cos + h1 * sin),
    h: Math.round(w1 * sin + h1 * cos),
  };
}

/** Largest axis-aligned rectangle (same orientation as `w`×`h`) that fits
 *  inside a `w`×`h` rectangle rotated by `angleRad` — the classic
 *  rotatedRectWithMaxArea. Returns {w,h} in the rotated image's own units. */
function rotatedRectWithMaxArea(w: number, h: number, angleRad: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const sin = Math.abs(Math.sin(angleRad));
  const cos = Math.abs(Math.cos(angleRad));
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  if (shortSide <= 2 * sin * cos * longSide || Math.abs(sin - cos) < 1e-10) {
    // Half-constrained case (fully constrained by the shorter side).
    const x = 0.5 * shortSide;
    const [wr, hr] = w >= h ? [x / sin, x / cos] : [x / cos, x / sin];
    return { w: wr, h: hr };
  }
  const cos2 = cos * cos - sin * sin;
  return { w: (w * cos - h * sin) / cos2, h: (h * cos - w * sin) / cos2 };
}

/** Auto-crop for a straighten: the largest centered rectangle with no exposed
 *  (background-filled) corners, expressed as a normalized crop in WORKING-image
 *  space. The editor applies this by default when the user only straightens, so
 *  a tilt never reveals empty triangles. Identity (full frame) when straighten
 *  is 0. `w`/`h` are the EXIF-oriented source dims. */
export function inscribedCropForStraighten(
  w: number,
  h: number,
  recipe: Pick<EditRecipe, "rotate" | "straighten">,
): EditCrop {
  if (!recipe.straighten) return { x: 0, y: 0, w: 1, h: 1 };
  const quarterSwaps = recipe.rotate === 90 || recipe.rotate === 270;
  const w1 = quarterSwaps ? h : w;
  const h1 = quarterSwaps ? w : h;
  const inner = rotatedRectWithMaxArea(w1, h1, toRad(recipe.straighten));
  const work = workingDimensions(w, h, recipe);
  const nw = Math.min(1, inner.w / work.w);
  const nh = Math.min(1, inner.h / work.h);
  return { x: (1 - nw) / 2, y: (1 - nh) / 2, w: nw, h: nh };
}

/** Resolve a normalized crop to an integer pixel extract rect on a
 *  `workingW`×`workingH` image, clamped to stay in bounds (worker sharp
 *  `.extract()` throws on a rect that overflows even by a pixel). Null crop →
 *  the whole frame. */
export function resolveCropRect(
  workingW: number,
  workingH: number,
  crop: EditCrop | null,
): { left: number; top: number; width: number; height: number } {
  if (!crop) return { left: 0, top: 0, width: workingW, height: workingH };
  const left = Math.min(workingW - 1, Math.max(0, Math.round(crop.x * workingW)));
  const top = Math.min(workingH - 1, Math.max(0, Math.round(crop.y * workingH)));
  const width = Math.max(1, Math.min(workingW - left, Math.round(crop.w * workingW)));
  const height = Math.max(1, Math.min(workingH - top, Math.round(crop.h * workingH)));
  return { left, top, width, height };
}
