import { NextResponse } from "next/server";
import { createAnnotationRequestSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { getCanvasAnnotations, rowToAnnotation } from "@/lib/annotations";

/** Canvas annotations — sticky notes, and freehand ink once it ships (ADR 0041).
 *  RLS scopes every query to the caller's workspace.
 *
 *  GET  ?project=<id|all> — the annotations the canvas hydrates from on a
 *       client-side scope switch (the project Server Component awaits the same
 *       reader directly).
 *  POST — create one. Geometry comes from the client because the viewport
 *         centre a note is dropped at is only known there. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = new URL(request.url).searchParams.get("project") ?? "all";
  return NextResponse.json({ annotations: await getCanvasAnnotations(supabase, scope) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = createAnnotationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { kind, x, y, w, h, color, body, style } = parsed.data;
  const projectId = parsed.data.projectId ?? null;

  // A project-scoped annotation's project must be visible to the caller (RLS) —
  // same check POST /api/canvas-groups makes.
  if (projectId) {
    const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // The Workspace this note was made in (ADR 0044). Validated the same way and
  // for the same reason as the project: RLS on `canvas_annotations` checks the
  // row's workspace, not what this column points at, so a caller could otherwise
  // file a note under someone else's board id. An unreadable one degrades to
  // null — the note belongs to the project canvas — rather than 404ing a note
  // the user has already drawn on screen.
  let boardId: string | null = parsed.data.boardId ?? null;
  if (boardId) {
    const { data: board } = await supabase.from("boards").select("id").eq("id", boardId).maybeSingle();
    if (!board) boardId = null;
  }

  const { data: row, error } = await supabase
    .from("canvas_annotations")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      board_id: boardId,
      kind,
      x,
      y,
      w,
      h,
      color,
      body,
      style,
      created_by: user.id,
    })
    .select("id, kind, project_id, board_id, x, y, w, h, color, body, style")
    .single();

  // 42P01 = undefined_table — migration 20260808000002 not pushed yet. The
  // reader degrades to an empty list on the same code; a write cannot, so it
  // says so rather than reporting a phantom success.
  if (error?.code === "42P01") {
    return NextResponse.json({ error: "annotations are not available yet" }, { status: 503 });
  }
  if (error || !row) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

  return NextResponse.json(rowToAnnotation(row));
}
