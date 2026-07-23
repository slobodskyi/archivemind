import type { SupabaseClient } from "@supabase/supabase-js";
import { artboardSettingsSchema, type CanvasGroup } from "@archivemind/shared";

/** Canvas groups — folders + artboards (ADR 0034). The server owns MEMBERSHIP +
 *  name + order + export settings (these tables); the on-canvas geometry stays a
 *  per-user client override in localStorage (ADR 0022 holds). RLS scopes every
 *  read to the caller's workspace.
 *
 *  Scope: `scope === "all"` = the workspace-wide canvas (project_id is null);
 *  otherwise a project id. Members are asset ids ordered by position (= PDF page
 *  order for artboards). */

interface GroupAssetRow {
  asset_id: string;
  position: number;
}
interface GroupRow {
  id: string;
  kind: "folder" | "artboard";
  name: string;
  project_id: string | null;
  sort_index: number;
  settings: unknown;
  canvas_group_assets: GroupAssetRow[];
}

const GROUP_SELECT = `id, kind, name, project_id, sort_index, settings,
     canvas_group_assets ( asset_id, position )`;

export async function getCanvasGroups(
  supabase: SupabaseClient,
  scope: string,
): Promise<CanvasGroup[]> {
  let query = supabase
    .from("canvas_groups")
    .select(GROUP_SELECT)
    .order("sort_index", { ascending: true })
    .order("created_at", { ascending: true });
  query = scope === "all" ? query.is("project_id", null) : query.eq("project_id", scope);

  const { data, error } = (await query) as {
    data: unknown[] | null;
    error: { code?: string } | null;
  };
  // The canvas_groups migration (20260723000002) may not be applied to this DB
  // yet — degrade to "no groups" instead of a hard crash, exactly like the
  // getProjectCards 42703 fallback. 42P01 = undefined_table.
  if (error?.code === "42P01" || error?.code === "42703") return [];
  if (error) throw error as unknown as Error;

  const rows = (data ?? []) as unknown as GroupRow[];
  return rows.map((g) => {
    const members = [...g.canvas_group_assets]
      .sort((a, b) => a.position - b.position || a.asset_id.localeCompare(b.asset_id))
      .map((m) => m.asset_id);
    // Folders carry no export config ({} in the DB); artboards parse to full
    // settings (defaults fill any gap, so an older row is safe).
    const settings = g.kind === "artboard" ? artboardSettingsSchema.parse(g.settings ?? {}) : null;
    return {
      id: g.id,
      kind: g.kind,
      name: g.name,
      projectId: g.project_id,
      sortIndex: g.sort_index,
      settings,
      members,
    };
  });
}

/** Single-folder-membership (ADR 0034): before adding assets to a folder,
 *  detach them from any OTHER folder in the same scope. Artboards are exempt —
 *  they deliberately share assets — so callers only invoke this for kind
 *  'folder'. RLS scopes the delete to the caller's own groups. */
export async function detachFromSiblingFolders(
  supabase: SupabaseClient,
  opts: { projectId: string | null; exceptGroupId: string; assetIds: string[] },
): Promise<void> {
  if (opts.assetIds.length === 0) return;
  let q = supabase.from("canvas_groups").select("id").eq("kind", "folder").neq("id", opts.exceptGroupId);
  q = opts.projectId === null ? q.is("project_id", null) : q.eq("project_id", opts.projectId);
  const { data: siblings, error } = await q;
  if (error) throw error;
  const ids = (siblings ?? []).map((r) => r.id as string);
  if (ids.length === 0) return;
  const { error: delErr } = await supabase
    .from("canvas_group_assets")
    .delete()
    .in("group_id", ids)
    .in("asset_id", opts.assetIds);
  if (delErr) throw delErr;
}

/** Next sort_index for a new group of `kind` in a scope — artboards append so
 *  their order is the PDF page order; folders share the sequence harmlessly. */
export async function nextGroupSortIndex(
  supabase: SupabaseClient,
  scope: { projectId: string | null; kind: "folder" | "artboard" },
): Promise<number> {
  let q = supabase
    .from("canvas_groups")
    .select("sort_index")
    .eq("kind", scope.kind)
    .order("sort_index", { ascending: false })
    .limit(1);
  q = scope.projectId === null ? q.is("project_id", null) : q.eq("project_id", scope.projectId);
  const { data, error } = await q;
  if (error) throw error;
  return data && data.length > 0 ? (data[0].sort_index as number) + 1 : 0;
}
