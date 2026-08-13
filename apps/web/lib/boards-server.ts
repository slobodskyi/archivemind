import type { SupabaseClient } from "@supabase/supabase-js";
import { assetLabelSchema, type Board } from "@archivemind/shared";

/** Workspaces — ADR 0044. Read seam awaited by the project page, so a project's
 *  workspaces are in the first paint the way `getCanvasGroups` is; the client
 *  never queries for them.
 *
 *  The server owns name, colour, order and MEMBERSHIP. The on-canvas geometry of
 *  the tiles stays a per-user client override (ADR 0022) — opening a workspace
 *  narrows which tiles exist, it does not store where they sit. */

interface BoardAssetRow {
  asset_id: string;
  position: number;
}
interface BoardRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  sort_order: number;
  deleted_at: string | null;
  board_assets: BoardAssetRow[];
}

const BOARD_SELECT = `id, project_id, name, color, sort_order, deleted_at,
     board_assets ( asset_id, position )`;

/** A project's workspaces — LIVE AND TRASHED in one array, each carrying its own
 *  `deletedAt` (`splitBoards` in lib/boards.ts does the separating). One query,
 *  because the header has to know on first paint whether there is anything to
 *  undo: the restore affordance appears only when a trashed workspace exists, so
 *  fetching that second list after mount would make the button pop in a beat
 *  after the delete it belongs to. A trashed board is at most a handful of rows
 *  and its membership is exactly what a restore needs back. */
export async function getBoards(supabase: SupabaseClient, projectId: string): Promise<Board[]> {
  const { data, error } = (await supabase
    .from("boards")
    .select(BOARD_SELECT)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })) as {
    data: unknown[] | null;
    error: { code?: string } | null;
  };
  // The boards migration (20260812000001) may not be applied to this database
  // yet, and a web deploy is not transactional with a migration push. Degrade to
  // "no workspaces" rather than taking the whole project page down over a chip
  // row — the same 42P01/42703 fallback `getCanvasGroups` makes.
  if (error?.code === "42P01" || error?.code === "42703") return [];
  if (error) throw error as unknown as Error;

  return ((data ?? []) as unknown as BoardRow[]).map((b) => ({
    id: b.id,
    projectId: b.project_id,
    name: b.name,
    // `catch` rather than `parse`: a colour from a future migration must not
    // throw on a page that only wants to draw a dot.
    color: assetLabelSchema.catch("blue").parse(b.color),
    sortOrder: b.sort_order,
    // `?? null`, never `undefined`: a live workspace must read as live even if
    // the field arrives missing. (A database without migration 20260813000001
    // does not get here at all — selecting the column raises 42703 and the
    // fallback above degrades the page to "no workspaces", the same trade the
    // reader already makes for the table itself.)
    deletedAt: b.deleted_at ?? null,
    assetIds: [...b.board_assets]
      .sort((a, z) => a.position - z.position || a.asset_id.localeCompare(z.asset_id))
      .map((m) => m.asset_id),
  }));
}

/** Next `sort_order` for a new workspace in a project — they append, so the chip
 *  row keeps the order they were made in. */
export async function nextBoardSortOrder(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("boards")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data.length > 0 ? (data[0].sort_order as number) + 1 : 0;
}
