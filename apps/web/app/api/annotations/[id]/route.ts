import { NextResponse } from "next/server";
import { patchAnnotationRequestSchema, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { rowToAnnotation } from "@/lib/annotations";

/** PATCH /api/annotations/[id] — move, resize, retype, recolour, restyle one
 *  annotation. DELETE — remove it. RLS scopes both (canvas_annotations_* =
 *  is_editor), so neither re-checks the workspace: a row outside it is simply
 *  invisible and comes back as a 404.
 *
 *  The patch is sparse by design. Typing sends only `body` (debounced), a drag
 *  sends only x/y on release, the swatch sends only `color` — sending the whole
 *  object each time is how a drag in one tab silently reverts a recolour made
 *  in another. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid annotation id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchAnnotationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  const { x, y, w, h, color, body, style } = parsed.data;
  if (x !== undefined) patch.x = x;
  if (y !== undefined) patch.y = y;
  if (w !== undefined) patch.w = w;
  if (h !== undefined) patch.h = h;
  if (color !== undefined) patch.color = color;
  if (body !== undefined) patch.body = body;
  if (style !== undefined) patch.style = style;

  // A board id from a body is validated, never trusted: RLS checks the ROW's
  // workspace, not what this column points at, so a caller could otherwise file
  // this under someone else's Workspace. An unreadable one is dropped rather
  // than 404ing the whole patch.
  if (parsed.data.boardId !== undefined) {
    if (parsed.data.boardId === null) {
      patch.board_id = null;
    } else {
      const { data: board } = await supabase
        .from("boards")
        .select("id")
        .eq("id", parsed.data.boardId)
        .maybeSingle();
      if (board) patch.board_id = parsed.data.boardId;
    }
  }

  const { data: row, error } = await supabase
    .from("canvas_annotations")
    .update(patch)
    .eq("id", id)
    .select("id, kind, project_id, board_id, x, y, w, h, color, body, style")
    .maybeSingle();
  if (error?.code === "42P01") {
    return NextResponse.json({ error: "annotations are not available yet" }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "annotation not found" }, { status: 404 });

  return NextResponse.json(rowToAnnotation(row));
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid annotation id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.from("canvas_annotations").delete().eq("id", id);
  if (error?.code === "42P01") {
    return NextResponse.json({ error: "annotations are not available yet" }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
