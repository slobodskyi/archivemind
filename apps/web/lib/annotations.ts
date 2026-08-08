import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canvasAnnotationKindSchema,
  noteBodySchema,
  noteStyleSchema,
  assetLabelSchema,
  type CanvasAnnotation,
} from "@archivemind/shared";

/** Canvas annotations — sticky notes, and freehand ink once it ships (ADR 0041).
 *
 *  The one canvas object that carries its GEOMETRY on the server. ADR 0022/0034
 *  keep tile positions, frames and folder boxes in localStorage because a
 *  photo's position is a per-user view preference over a thing that exists
 *  anyway; an annotation exists nowhere else, so its coordinates are its
 *  content. Nothing else about canvas layout moved.
 *
 *  Scope: `scope === "all"` = the workspace-wide canvas (project_id is null);
 *  otherwise a project id. Same shape as lib/canvas-groups.ts. */

interface AnnotationRow {
  id: string;
  kind: string;
  project_id: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  body: unknown;
  style: unknown;
}

const ANNOTATION_SELECT = "id, kind, project_id, x, y, w, h, color, body, style";

export async function getCanvasAnnotations(
  supabase: SupabaseClient,
  scope: string,
): Promise<CanvasAnnotation[]> {
  let query = supabase
    .from("canvas_annotations")
    .select(ANNOTATION_SELECT)
    .order("created_at", { ascending: true });
  query = scope === "all" ? query.is("project_id", null) : query.eq("project_id", scope);

  const { data, error } = (await query) as {
    data: unknown[] | null;
    error: { code?: string } | null;
  };
  // Migration 20260808000002 may not be applied to this DB yet — degrade to "no
  // annotations" rather than crashing the whole canvas, exactly like
  // getCanvasGroups. 42P01 = undefined_table, 42703 = undefined_column.
  if (error?.code === "42P01" || error?.code === "42703") return [];
  if (error) throw error as unknown as Error;

  return ((data ?? []) as unknown as AnnotationRow[]).map(rowToAnnotation);
}

/** One row → the client shape. `body`/`style` are jsonb parsed by zod, never by
 *  SQL: defaults fill anything a row written before a knob existed is missing,
 *  which is the property that lets the note gain settings with no migration. */
export function rowToAnnotation(row: AnnotationRow): CanvasAnnotation {
  return {
    id: row.id,
    kind: canvasAnnotationKindSchema.catch("note").parse(row.kind),
    projectId: row.project_id,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    color: assetLabelSchema.catch("yellow").parse(row.color),
    body: noteBodySchema.parse(row.body ?? {}),
    style: noteStyleSchema.parse(row.style ?? {}),
  };
}
