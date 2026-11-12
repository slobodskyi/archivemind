import { z } from "zod";
import {
  assetLabelSchema,
  captionLangSchema,
  captionStyleSchema,
  uuidSchema,
  type CaptionLang,
  type CaptionStyleKey,
} from "@archivemind/shared";

/** Project share links (ADR 0051): the editor-side contracts. A link carries
 *  its own rights — download, upload, or both — and always expires. */

export const PROJECT_SHARE_EXPIRY_DAYS = [1, 7, 30, 90] as const;
export type ProjectShareExpiryDays = (typeof PROJECT_SHARE_EXPIRY_DAYS)[number];
export const PROJECT_SHARE_DEFAULT_EXPIRY_DAYS: ProjectShareExpiryDays = 7;
export const PROJECT_SHARE_LABEL_MAX = 80;
/** create_project_share()'s cap on live links per project. */
export const PROJECT_SHARE_LIVE_LIMIT = 25;
/** The project_shares column defaults — what one link may receive. Shown to
 *  the editor; the database is what enforces them. */
export const PROJECT_SHARE_MAX_FILES = 2000;
export const PROJECT_SHARE_MAX_BYTES = 20 * 1024 ** 3;

const expiryDaysSchema = z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]);

export const projectShareModeSchema = z.enum(["download", "upload", "both"]);
export type ProjectShareMode = z.infer<typeof projectShareModeSchema>;

export function projectShareRights(mode: ProjectShareMode): { canDownload: boolean; canUpload: boolean } {
  return { canDownload: mode !== "upload", canUpload: mode !== "download" };
}

export function projectShareMode(canDownload: boolean, canUpload: boolean): ProjectShareMode {
  if (canDownload && canUpload) return "both";
  return canUpload ? "upload" : "download";
}

/** What a link carries inside its project (ADR 0053 §1): every file of the
 *  project, the files of one Workspace, or a fixed list picked at creation. */
export const shareScopeSchema = z.enum(["project", "board", "selection"]);
export type ShareScope = z.infer<typeof shareScopeSchema>;
/** create_project_share()'s bound on a selection link's list — the same number
 *  as a link's upload quota. */
export const PROJECT_SHARE_SELECTION_MAX = 2000;

export const createProjectShareRequestSchema = z
  .object({
    mode: projectShareModeSchema,
    expiresInDays: expiryDaysSchema,
    label: z.string().trim().max(PROJECT_SHARE_LABEL_MAX).optional(),
    // Optional so a browser built before ADR 0053 still makes project links.
    scope: shareScopeSchema.default("project"),
    boardId: uuidSchema.optional(),
    assetIds: z.array(uuidSchema).min(1).max(PROJECT_SHARE_SELECTION_MAX).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Each scope names exactly its own target, so a stray id is a malformed
    // request here rather than a 22023 from the database.
    const wantsBoard = value.scope === "board";
    const wantsList = value.scope === "selection";
    if (wantsBoard !== (value.boardId !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["boardId"], message: "boardId belongs to a board link only" });
    }
    if (wantsList !== (value.assetIds !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["assetIds"], message: "assetIds belong to a selection link only" });
    }
    // A list never grows, so it cannot receive files (ADR 0053 §1).
    if (wantsList && value.mode !== "download") {
      ctx.addIssue({ code: "custom", path: ["mode"], message: "a selection link is download-only" });
    }
  });
export type CreateProjectShareRequest = z.infer<typeof createProjectShareRequestSchema>;

/** Extend (a new deadline counted from now; the URL does not change) and/or
 *  relabel. An empty label clears it. */
export const updateProjectShareRequestSchema = z
  .object({
    expiresInDays: expiryDaysSchema.optional(),
    label: z.string().trim().max(PROJECT_SHARE_LABEL_MAX).nullable().optional(),
  })
  .strict()
  .refine((value) => value.expiresInDays !== undefined || value.label !== undefined, {
    message: "nothing to update",
  });
export type UpdateProjectShareRequest = z.infer<typeof updateProjectShareRequestSchema>;

/** `inactive`: not expired, but its creator can no longer share (they left the
 *  workspace or lost the editor role) or its project is in Trash. */
export const projectShareStatusSchema = z.enum(["live", "expired", "inactive"]);
export type ProjectShareStatus = z.infer<typeof projectShareStatusSchema>;

const timestamp = z.string().datetime({ offset: true });

/** One row of list_project_shares(). */
export const projectShareRowSchema = z.object({
  id: uuidSchema,
  label: z.string().nullable(),
  can_download: z.boolean(),
  can_upload: z.boolean(),
  status: projectShareStatusSchema,
  created_at: timestamp,
  expires_at: timestamp,
  created_by: uuidSchema.nullable(),
  created_by_name: z.string().nullable(),
  token_ciphertext: z.string().nullable(),
  download_count: z.number().int().nonnegative(),
  last_opened_at: timestamp.nullable(),
  last_upload_at: timestamp.nullable(),
  files_received: z.number().int().nonnegative(),
  bytes_received: z.number().nonnegative(),
  max_files: z.number().int().positive(),
  max_bytes: z.number().positive(),
  // ADR 0053. Defaulted, so a row from before the migration still parses.
  scope: shareScopeSchema.default("project"),
  board_id: uuidSchema.nullable().default(null),
  board_name: z.string().nullable().default(null),
  // Text, not the enum: a colour or language added later must not fail the
  // whole list. toProjectShareSummary narrows them.
  board_color: z.string().nullable().default(null),
  file_count: z.number().int().nonnegative().nullable().default(null),
  show_boards: z.boolean().default(false),
  show_labels: z.boolean().default(false),
  show_tags: z.boolean().default(false),
  caption_lang: z.string().nullable().default(null),
  caption_style: z.string().nullable().default(null),
});
export type ProjectShareRow = z.infer<typeof projectShareRowSchema>;

/** What the editor's browser receives. `path` is `/s/{token}` for a live link
 *  this server could decrypt and null otherwise: a link without a readable
 *  ciphertext still works, it just cannot be copied again. The digest and the
 *  ciphertext never reach the browser. */
export const projectShareSummarySchema = z.object({
  id: uuidSchema,
  label: z.string().nullable(),
  mode: projectShareModeSchema,
  status: projectShareStatusSchema,
  path: z.string().nullable(),
  createdAt: timestamp,
  expiresAt: timestamp,
  createdByName: z.string().nullable(),
  downloadCount: z.number().int().nonnegative(),
  lastOpenedAt: timestamp.nullable(),
  lastUploadAt: timestamp.nullable(),
  filesReceived: z.number().int().nonnegative(),
  bytesReceived: z.number().nonnegative(),
  maxFiles: z.number().int().positive(),
  maxBytes: z.number().positive(),
  scope: shareScopeSchema,
  boardId: uuidSchema.nullable(),
  /** Null once the Workspace is deleted for good: the link is dead then. */
  boardName: z.string().nullable(),
  boardColor: assetLabelSchema.nullable(),
  /** Files the scope holds right now — live, not as it was at creation. */
  fileCount: z.number().int().nonnegative().nullable(),
  details: z.object({
    boards: z.boolean(),
    labels: z.boolean(),
    tags: z.boolean(),
    caption: z.object({ lang: captionLangSchema, style: captionStyleSchema }).nullable(),
  }),
});
export type ProjectShareSummary = z.infer<typeof projectShareSummarySchema>;

export const listProjectSharesResponseSchema = z.object({ shares: z.array(projectShareSummarySchema) });

/** GET /api/project-shares/[id]/received — what a link brought in that is
 *  still live in its project. */
export const receivedAssetsResponseSchema = z.object({ assetIds: z.array(z.string().uuid()) });
export const projectShareResponseSchema = z.object({ share: projectShareSummarySchema });

export function projectSharePath(token: string): string {
  return `/s/${token}`;
}

export function toProjectShareSummary(row: ProjectShareRow, path: string | null): ProjectShareSummary {
  return {
    id: row.id,
    label: row.label,
    mode: projectShareMode(row.can_download, row.can_upload),
    status: row.status,
    path: row.status === "live" ? path : null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    createdByName: row.created_by_name,
    downloadCount: row.download_count,
    lastOpenedAt: row.last_opened_at,
    lastUploadAt: row.last_upload_at,
    filesReceived: row.files_received,
    bytesReceived: row.bytes_received,
    maxFiles: row.max_files,
    maxBytes: row.max_bytes,
    scope: row.scope,
    boardId: row.board_id,
    boardName: row.board_name,
    boardColor: narrow(assetLabelSchema, row.board_color),
    fileCount: row.file_count,
    details: {
      boards: row.show_boards,
      labels: row.show_labels,
      tags: row.show_tags,
      caption: shareCaption(row.caption_lang, row.caption_style),
    },
  };
}

function narrow<T>(schema: z.ZodType<T>, value: string | null): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function shareCaption(
  lang: string | null,
  style: string | null,
): { lang: CaptionLang; style: CaptionStyleKey } | null {
  const l = narrow(captionLangSchema, lang);
  const s = narrow(captionStyleSchema, style);
  return l && s ? { lang: l, style: s } : null;
}

export function liveShareCount(shares: readonly ProjectShareSummary[]): number {
  return shares.filter((share) => share.status === "live").length;
}
