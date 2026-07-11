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

export async function getProjectCards(supabase: SupabaseClient): Promise<ProjectCard[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      `id, name, created_at,
       project_assets ( assets ( status, asset_previews ( size, r2_key ) ) )`,
    )
    .order("created_at", { ascending: true });
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
