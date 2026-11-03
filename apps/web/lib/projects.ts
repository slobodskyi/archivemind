import type { SupabaseClient } from "@supabase/supabase-js";
import { presignGet } from "@/lib/r2";

/** Homepage project cards (issue #17): each project with its active-asset
 *  count and up to 4 presigned thumb previews for the card collage. RLS scopes
 *  everything to the caller's workspace. */

export interface ProjectCard {
  id: string;
  name: string;
  count: number;
  /** Presigned thumb URLs (≤4) for the card collage; empty for empty projects. */
  previews: string[];
  /** When the project entered the Trash — only populated for scope="trash",
   *  where it drives the "N days left" countdown (ADR 0033). */
  deletedAt?: string | null;
  /** Live project share links (ADR 0051). The card marks a project anyone
   *  outside the workspace can currently reach. Absent for scope="trash",
   *  where no link is live. */
  liveShares?: number;
}

const CARD_PREVIEWS = 4;

interface PreviewRow {
  size: string;
  r2_key: string;
}
interface AssetRow {
  status: string;
  asset_previews: PreviewRow[];
}
interface ProjectAssetRow {
  assets: AssetRow | null;
}
interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  deleted_at?: string | null;
  project_assets: ProjectAssetRow[];
}

export type ProjectScope = "active" | "archived" | "trash";

const PROJECT_CARD_SELECT = `id, name, created_at,
     project_assets ( assets ( status, asset_previews ( size, r2_key ) ) )`;

export async function getProjectCards(
  supabase: SupabaseClient,
  scope: ProjectScope = "active",
): Promise<ProjectCard[]> {
  // deleted_at only joins the trash select: adding it to the shared constant
  // would break the 42703 pre-migration fallback below (the retry re-runs the
  // same columns), and trash on a pre-migration DB already degrades to [].
  // (The runtime select string defeats supabase-js's literal query parser, so
  // the result is typed at this boundary — rows are cast to ProjectRow below
  // exactly as before.)
  type CardQueryResult = { data: unknown[] | null; error: { code?: string; message?: string } | null };
  const select = scope === "trash" ? `${PROJECT_CARD_SELECT}, deleted_at` : PROJECT_CARD_SELECT;
  let query = supabase.from("projects").select(select).order("created_at", { ascending: true });
  if (scope === "active") query = query.is("archived_at", null).is("deleted_at", null);
  else if (scope === "archived") query = query.not("archived_at", "is", null).is("deleted_at", null);
  else query = query.not("deleted_at", "is", null);

  // Live-link counts ride beside the card query rather than inside it: the
  // RPC is scoped to the caller's memberships and needs no workspace id.
  const shareCounts = scope === "trash" ? Promise.resolve(new Map<string, number>()) : liveShareCounts(supabase);
  let { data, error } = (await query) as CardQueryResult;
  if (error?.code === "42703") {
    // archived_at/deleted_at migration (20260713000001) not applied to this
    // database yet — degrade to pre-migration behavior instead of a hard
    // crash: every project counts as active, Archived/Trash stay empty.
    if (scope !== "active") return [];
    ({ data, error } = (await supabase
      .from("projects")
      .select(PROJECT_CARD_SELECT)
      .order("created_at", { ascending: true })) as CardQueryResult);
  }
  if (error) throw error;

  const rows = (data ?? []) as unknown as ProjectRow[];
  const liveShares = await shareCounts;
  return Promise.all(
    rows.map(async (p) => {
      const active = p.project_assets.map((pa) => pa.assets).filter((a): a is AssetRow => a?.status === "active");
      const thumbKeys = active
        .map((a) => a.asset_previews.find((pv) => pv.size === "thumb")?.r2_key)
        .filter((k): k is string => Boolean(k))
        .slice(0, CARD_PREVIEWS);
      const previews = await Promise.all(thumbKeys.map((k) => presignGet(k)));
      return {
        id: p.id,
        name: p.name,
        count: active.length,
        previews,
        ...(scope === "trash" ? { deletedAt: p.deleted_at ?? null } : { liveShares: liveShares.get(p.id) ?? 0 }),
      };
    }),
  );
}

/** Live share links per project (ADR 0051). A card without its count is still
 *  a card: a failed or missing RPC (a database before migration
 *  20261103000001) degrades to "not shared" instead of breaking the hub. */
async function liveShareCounts(supabase: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("list_project_share_counts");
  const counts = new Map<string, number>();
  if (error || !Array.isArray(data)) return counts;
  for (const row of data as { project_id?: unknown; live_count?: unknown }[]) {
    if (typeof row.project_id === "string" && typeof row.live_count === "number") {
      counts.set(row.project_id, row.live_count);
    }
  }
  return counts;
}

/** Count of all active assets in the workspace — for the pinned "All my
 *  files" card. */
export async function getAllAssetsCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}
