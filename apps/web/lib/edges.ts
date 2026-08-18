import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanvasEdge, CanvasEdgeEndpoint } from "@archivemind/shared";

/** Canvas edges — user-drawn connections inside a Workspace (ADR 0048).
 *
 *  An edge is a RELATION: references only, no geometry — its path is derived
 *  at render time from wherever its endpoints currently are. This file is the
 *  ONLY place that knows the table's four-FK endpoint shape; everything above
 *  it (API, hook, render) sees the flat { kind, id } endpoint from
 *  packages/shared. */

interface EdgeRow {
  id: string;
  board_id: string;
  from_asset_id: string | null;
  from_annotation_id: string | null;
  to_asset_id: string | null;
  to_annotation_id: string | null;
}

export const EDGE_SELECT =
  "id, board_id, from_asset_id, from_annotation_id, to_asset_id, to_annotation_id";

export async function getCanvasEdges(
  supabase: SupabaseClient,
  projectId: string,
): Promise<CanvasEdge[]> {
  // Project-wide, not per-board: board switching is client-side (the project
  // page remounts per project via key={ws-...}, boards do not), so the first
  // paint loads every board's edges the same way it loads every board's notes.
  const { data, error } = (await supabase
    .from("canvas_edges")
    .select(EDGE_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })) as {
    data: unknown[] | null;
    error: { code?: string } | null;
  };
  // Migration 20260818000001 may not be applied to this DB yet — degrade to
  // "no edges" rather than crashing the canvas, exactly like getCanvasGroups
  // and getCanvasAnnotations. 42P01 = undefined_table, 42703 = undefined_column.
  if (error?.code === "42P01" || error?.code === "42703") return [];
  if (error) throw error as unknown as Error;

  return ((data ?? []) as unknown as EdgeRow[])
    .map(rowToEdge)
    .filter((edge): edge is CanvasEdge => edge !== null);
}

function endpoint(assetId: string | null, annotationId: string | null): CanvasEdgeEndpoint | null {
  if (assetId) return { kind: "asset", id: assetId };
  if (annotationId) return { kind: "annotation", id: annotationId };
  return null;
}

/** One row → the flat client shape. A side with no id (impossible under the
 *  table's CHECKs, but this reader must not trust that forever) drops the row
 *  rather than fabricating an endpoint. */
export function rowToEdge(row: EdgeRow): CanvasEdge | null {
  const from = endpoint(row.from_asset_id, row.from_annotation_id);
  const to = endpoint(row.to_asset_id, row.to_annotation_id);
  if (!from || !to) return null;
  return { id: row.id, boardId: row.board_id, from, to };
}

/** The flat endpoint → the table's column pair, for inserts. */
export function endpointColumns(
  side: "from" | "to",
  point: CanvasEdgeEndpoint,
): Record<string, string> {
  return point.kind === "asset"
    ? { [`${side}_asset_id`]: point.id }
    : { [`${side}_annotation_id`]: point.id };
}
