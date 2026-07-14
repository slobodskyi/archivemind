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
  project_assets: ProjectAssetRow[];
}

export type ProjectScope = "active" | "archived" | "trash";

const PROJECT_CARD_SELECT = `id, name, created_at,
     project_assets ( assets ( status, asset_previews ( size, r2_key ) ) )`;

export async function getProjectCards(
  supabase: SupabaseClient,
  scope: ProjectScope = "active",
): Promise<ProjectCard[]> {
  let query = supabase.from("projects").select(PROJECT_CARD_SELECT).order("created_at", { ascending: true });
  if (scope === "active") query = query.is("archived_at", null).is("deleted_at", null);
  else if (scope === "archived") query = query.not("archived_at", "is", null).is("deleted_at", null);
  else query = query.not("deleted_at", "is", null);

  let { data, error } = await query;
  if (error?.code === "42703") {
    // archived_at/deleted_at migration (20260713000001) not applied to this
    // database yet — degrade to pre-migration behavior instead of a hard
    // crash: every project counts as active, Archived/Trash stay empty.
    if (scope !== "active") return [];
    ({ data, error } = await supabase
      .from("projects")
      .select(PROJECT_CARD_SELECT)
      .order("created_at", { ascending: true }));
  }
  if (error) throw error;

  const rows = (data ?? []) as unknown as ProjectRow[];
  return Promise.all(
    rows.map(async (p) => {
      const active = p.project_assets.map((pa) => pa.assets).filter((a): a is AssetRow => a?.status === "active");
      const thumbKeys = active
        .map((a) => a.asset_previews.find((pv) => pv.size === "thumb")?.r2_key)
        .filter((k): k is string => Boolean(k))
        .slice(0, CARD_PREVIEWS);
      const previews = await Promise.all(thumbKeys.map((k) => presignGet(k)));
      return { id: p.id, name: p.name, count: active.length, previews };
    }),
  );
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
