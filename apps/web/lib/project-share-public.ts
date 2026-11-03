import { z } from "zod";
import type { PublicationRights } from "@/lib/publication-shares";

/** What a project share link's holder may see (ADR 0051 §6) — the shapes the
 *  public `/s/{token}` page and its routes speak. Client-safe: no R2 key and no
 *  signature lives here; every file is addressed as a `/s/{token}/media/…` path
 *  that re-checks the token when the browser asks for the bytes. */

/** Files per page, server-rendered and per `GET /s/{token}/assets` call. The
 *  resolver refuses anything above 200. */
export const PROJECT_SHARE_PAGE_SIZE = 200;

export const projectShareMediaVariantSchema = z.enum(["thumb", "medium", "original"]);
export type ProjectShareMediaVariant = z.infer<typeof projectShareMediaVariantSchema>;

export interface ProjectShareView {
  projectName: string;
  canDownload: boolean;
  canUpload: boolean;
  expiresAt: string;
  rights: PublicationRights;
  /** Live files in the project; null on an upload-only link, which is told
   *  nothing about what the project already holds. */
  fileCount: number | null;
}

export interface ProjectShareFile {
  id: string;
  kind: string;
  filename: string;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  hasPreview: boolean;
  /** False for Drive/OneDrive files: the download is the 1024px web preview. */
  hasOriginal: boolean;
}

export interface ProjectSharePage {
  files: ProjectShareFile[];
  nextCursor: string | null;
}

/** Status of a link ZIP, as coarse as the resolver makes it. */
export interface ProjectShareDownloadStatus {
  status: "queued" | "running" | "done" | "failed" | "canceled";
  progress: number;
  error: "too_large" | "failed" | null;
}

// The keyset cursor is (sort_at, id) carried opaquely. sort_at stays the exact
// string Postgres returned: a Date round-trip drops microseconds, and a cursor
// one microsecond off skips or repeats a file at every page boundary.
const cursorSchema = z.tuple([z.string().datetime({ offset: true }), z.string().uuid()]);

export function encodeShareCursor(sortAt: string, id: string): string {
  return btoa(JSON.stringify([sortAt, id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShareCursor(cursor: string): { sortAt: string; id: string } | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) return null;
  try {
    const json = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = cursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? { sortAt: parsed.data[0], id: parsed.data[1] } : null;
  } catch {
    return null;
  }
}

function sharePath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}

export function shareMediaHref(token: string, assetId: string, variant: ProjectShareMediaVariant): string {
  return `${sharePath(token)}/media/${encodeURIComponent(assetId)}/${variant}`;
}

export function shareAssetsHref(token: string, cursor: string): string {
  return `${sharePath(token)}/assets?cursor=${encodeURIComponent(cursor)}`;
}

export function shareDownloadsHref(token: string, jobId?: string): string {
  return jobId
    ? `${sharePath(token)}/downloads/${encodeURIComponent(jobId)}`
    : `${sharePath(token)}/downloads`;
}
