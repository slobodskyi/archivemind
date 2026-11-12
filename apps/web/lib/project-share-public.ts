import { z } from "zod";
import type { AssetLabel } from "@archivemind/shared";
import type { ShareDetails, ShareScope } from "@/lib/project-shares";
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
  /** What the link carries inside the project (ADR 0053). */
  scope: ShareScope;
  /** A Workspace link's Workspace — the one place its name crosses. */
  boardName: string | null;
  /** What the link shows beside its files (ADR 0053 §3). Every detail that is
   *  off is also null on every file, from the resolver itself. */
  details: ShareDetails;
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
  /** Null unless the link shows colour labels — and for a file with none. */
  label: AssetLabel | null;
  /** Null unless the link shows tags; at most 24 names. */
  tags: string[] | null;
  /** The link's one caption (language × style), or null. */
  caption: string | null;
}

/** The filter row (ADR 0053 §4): one entry per value of each detail the link
 *  turned on, each counted over the link's live files in SQL. */
export interface ProjectShareFacets {
  boards: { id: string; name: string; color: AssetLabel | null; count: number }[];
  labels: { label: AssetLabel; count: number }[];
  tags: { name: string; count: number }[];
}

export const EMPTY_SHARE_FACETS: ProjectShareFacets = { boards: [], labels: [], tags: [] };

/** A filter the recipient applied. Each one narrows; they combine. */
export interface ProjectShareFilter {
  board?: string;
  label?: AssetLabel;
  tag?: string;
}

/** How many files the filter matches, when SQL counted it: the whole link
 *  with none, that facet's own count with one. Two or more combine in ways no
 *  facet counted, so there is no honest number to show — null. */
export function filteredShareTotal(
  filter: ProjectShareFilter,
  facets: ProjectShareFacets,
  fileCount: number,
): number | null {
  const active = activeShareFilters(filter);
  if (active === 0) return fileCount;
  if (active > 1) return null;
  if (filter.board) return facets.boards.find((board) => board.id === filter.board)?.count ?? null;
  if (filter.label) return facets.labels.find((entry) => entry.label === filter.label)?.count ?? null;
  return facets.tags.find((tag) => tag.name === filter.tag)?.count ?? null;
}

/** The longest tag the resolver will filter by. */
export const SHARE_TAG_FILTER_MAX = 200;

export function activeShareFilters(filter: ProjectShareFilter): number {
  return [filter.board, filter.label, filter.tag].filter((value) => value !== undefined).length;
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

/** The next page of files — or, with no cursor, the first page under a
 *  filter. The cursor stays opaque; the filter rides beside it, so a page
 *  boundary is the same keyset whatever narrows the list. */
export function shareAssetsHref(token: string, cursor: string | null, filter: ProjectShareFilter = {}): string {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (filter.board) params.set("board", filter.board);
  if (filter.label) params.set("label", filter.label);
  if (filter.tag) params.set("tag", filter.tag);
  const query = params.toString();
  return `${sharePath(token)}/assets${query ? `?${query}` : ""}`;
}

export function shareDownloadsHref(token: string, jobId?: string): string {
  return jobId
    ? `${sharePath(token)}/downloads/${encodeURIComponent(jobId)}`
    : `${sharePath(token)}/downloads`;
}
