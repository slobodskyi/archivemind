import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** Server-side reader for the Usage & Storage page (migration
 *  20260727000002). One RPC, one round trip, RLS-scoped — a Server Component
 *  awaits this directly, the same way `getProjectCards` is consumed.
 *
 *  The shape below mirrors `workspace_usage()`'s jsonb exactly. It is the seam:
 *  when these aggregates outgrow a live query, the function body becomes a read
 *  of a worker-maintained daily rollup and nothing here changes. */

export interface UsagePlan {
  id: string;
  name: string;
  /** null = unlimited. Every shipped plan has a number; the null path exists so
   *  an internal/comped workspace can be given one without a UI change. */
  storage_bytes: number | null;
  monthly_credits: number | null;
  /** False for every plan we ship — limits are drawn, never enforced. */
  enforced: boolean;
}

export interface UsageStorage {
  originals: number;
  previews: number;
  edits: number;
  exports: number;
  /** Deleted-but-not-yet-purged assets. Counted in `total` because the bytes
   *  are still in R2 — the point of showing it is that it is reclaimable. */
  trash: number;
  total: number;
  /** Bytes that exist only in Google Drive (files with no r2_key). Not part of
   *  `total`: they cost the workspace nothing but their previews. */
  linked: number;
  /** Rows written before the byte columns existed. Non-zero means the storage
   *  card is under-reporting and says so — run the worker's
   *  backfill-derivative-bytes script to clear it. */
  unmeasured: { previews: number; edits: number; exports: number };
}

export interface UsageCredits {
  analyze: number;
  captions: number;
  /** analyze + captions. Search/export/ingest are 0 by design — see
   *  packages/shared CREDIT_COST. */
  total: number;
  searches: number;
  exports: number;
  ingested_bytes: number;
}

export interface UsageArchive {
  photos: number;
  analyzed: number;
  captioned: number;
  facts_confirmed: number;
  trashed: number;
  exports: number;
}

export interface UsageProject {
  id: string;
  name: string;
  photos: number;
  bytes: number;
}

export interface UsageSource {
  origin: string;
  photos: number;
  stored_bytes: number;
  linked_bytes: number;
}

export interface UsageDay {
  day: string;
  credits: number;
}

export interface UsageActivity {
  event_type: string;
  at: string;
  units: number;
  bytes: number;
  project: string | null;
}

export interface UsageSnapshot {
  /** Null only when the caller is not a member of the workspace — the page
   *  treats that as "no data" rather than rendering a plan it can't read. */
  plan: UsagePlan | null;
  period: { start: string; end: string };
  storage: UsageStorage;
  credits: UsageCredits;
  archive: UsageArchive;
  by_project: UsageProject[];
  unassigned: { photos: number; bytes: number };
  by_source: UsageSource[];
  daily: UsageDay[];
  recent: UsageActivity[];
}

export async function getWorkspaceUsage(supabase: SupabaseClient): Promise<UsageSnapshot | null> {
  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return null;

  const { data, error } = await supabase.rpc("workspace_usage", { ws: workspaceId });
  if (error) throw error;
  return (data as UsageSnapshot | null) ?? null;
}
