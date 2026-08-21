import type { SupabaseClient } from "@supabase/supabase-js";
import {
  trashItemsRpcSchema,
  type TrashFilterKey,
  type TrashItem,
  type TrashResponse,
  type TrashSort,
} from "@archivemind/shared";
import { presignGet } from "./r2";

/** Server-side reader for the Trash (migration 20260821000001, ADR 0049).
 *
 *  One RPC, one round trip, RLS-scoped — the same shape as `lib/usage.ts`. The
 *  function returns trashed projects, Workspaces, assets and content drafts as
 *  one filtered/sorted/paged list, because sorting by size or paging honestly
 *  across four tables cannot be assembled in a browser without first reading
 *  all of it — which is exactly what the 500-row-no-total read this replaces
 *  got wrong.
 *
 *  This module is the ONLY place R2 keys become URLs, and it signs the rendered
 *  page alone. */

export interface TrashQuery {
  /** Chip keys to keep; empty/undefined = everything. */
  types?: TrashFilterKey[];
  /** Scopes the project-scoped kinds (Workspaces, drafts) for the in-canvas
   *  panel. Trashed assets and projects stay workspace-global. */
  projectId?: string | null;
  query?: string;
  sort?: TrashSort;
  /** Keep only what expires within N days — the "expiring soon" chip. */
  expiringDays?: number | null;
  limit?: number;
  offset?: number;
}

export const TRASH_PAGE_SIZE = 60;

const EMPTY: TrashResponse = {
  items: [],
  total: 0,
  totalBytes: 0,
  oldestExpiresAt: null,
  counts: {},
  expiringSoon: 0,
  retentionDays: 30,
};

export async function getTrashItems(
  supabase: SupabaseClient,
  query: TrashQuery = {},
): Promise<TrashResponse> {
  const { data, error } = await supabase.rpc("trash_items", {
    p_types: query.types && query.types.length > 0 ? query.types : null,
    p_project: query.projectId ?? null,
    p_query: query.query?.trim() || null,
    p_sort: query.sort ?? "recent",
    p_expiring_days: query.expiringDays ?? null,
    p_limit: query.limit ?? TRASH_PAGE_SIZE,
    p_offset: query.offset ?? 0,
  });

  // trash_items() not deployed to this database yet — degrade to an empty
  // Trash rather than a hard crash, the same posture getProjectCards takes on a
  // missing column. PGRST202 is PostgREST's "no such function".
  if (error?.code === "PGRST202") return EMPTY;
  if (error) throw error;

  // Parsed, not cast: supabase.rpc() is untyped, so a drifted signature would
  // otherwise compile clean and surface as a runtime shape error in production.
  const parsed = trashItemsRpcSchema.parse(data);

  const items: TrashItem[] = await Promise.all(
    parsed.items.map(async (row) => ({
      kind: row.kind,
      id: row.id,
      name: row.name,
      assetKind: row.asset_kind,
      mime: row.mime,
      thumb: row.thumb_key ? await presignGet(row.thumb_key) : null,
      color: row.color,
      bytes: row.bytes,
      count: row.item_count,
      location: row.location,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      expiresAt: row.expires_at,
    })),
  );

  return {
    items,
    total: parsed.total,
    totalBytes: parsed.total_bytes,
    oldestExpiresAt: parsed.oldest_expires_at,
    counts: parsed.counts,
    expiringSoon: parsed.expiring_soon,
    retentionDays: parsed.retention_days,
  };
}
