import { NextResponse } from "next/server";
import { createEdgeRequestSchema, type CanvasEdgeEndpoint } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { getCanvasEdges, rowToEdge, endpointColumns, EDGE_SELECT } from "@/lib/edges";

/** Canvas edges — user-drawn connections inside a Workspace (ADR 0048).
 *  RLS scopes every query to the caller's workspace; edges are immutable, so
 *  the API is GET/POST here and DELETE in [id] — no PATCH exists.
 *
 *  GET  ?project=<id> — the project's edges (the Server Component awaits the
 *       same reader directly on first paint).
 *  POST — draw one. Beyond RLS's tenancy checks, this route owns the one rule
 *         the database cannot express without a trigger: both endpoints must
 *         be MEMBERS of the edge's board. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get("project");
  if (!projectId) return NextResponse.json({ error: "project is required" }, { status: 400 });
  return NextResponse.json({ edges: await getCanvasEdges(supabase, projectId) });
}

/** True when the endpoint is a member of the board: an asset in board_assets,
 *  or a note annotation owned by the board. One boolean for both kinds so the
 *  caller can answer with one undifferentiated 404 — a miss must not reveal
 *  whether the id exists at all (the generate route's stance). */
async function belongsToBoard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  boardId: string,
  point: CanvasEdgeEndpoint,
): Promise<boolean> {
  if (point.kind === "asset") {
    const { data } = await supabase
      .from("board_assets")
      .select("asset_id")
      .eq("board_id", boardId)
      .eq("asset_id", point.id)
      .maybeSingle();
    return Boolean(data);
  }
  const { data } = await supabase
    .from("canvas_annotations")
    .select("id")
    .eq("id", point.id)
    .eq("board_id", boardId)
    .eq("kind", "note")
    .maybeSingle();
  return Boolean(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = createEdgeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { boardId, from, to } = parsed.data;

  // The board must be live and the caller's. A trashed board still renders no
  // canvas to draw on, so an edge filed into one is a stale client, not a
  // user intent.
  const { data: board } = await supabase
    .from("boards")
    .select("id, project_id")
    .eq("id", boardId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!board) return NextResponse.json({ error: "board_not_found" }, { status: 404 });

  // Board coherence — the rule RLS deliberately leaves to this route (see the
  // migration): every endpoint is a member of this board. One undifferentiated
  // 404 for any miss, so foreign or deleted ids are not an existence oracle.
  const [fromOk, toOk] = await Promise.all([
    belongsToBoard(supabase, boardId, from),
    belongsToBoard(supabase, boardId, to),
  ]);
  if (!fromOk || !toOk) {
    return NextResponse.json({ error: "endpoint_not_found" }, { status: 404 });
  }

  const { data: row, error } = await supabase
    .from("canvas_edges")
    .insert({
      workspace_id: workspaceId,
      project_id: board.project_id as string,
      board_id: boardId,
      ...endpointColumns("from", from),
      ...endpointColumns("to", to),
      created_by: user.id,
    })
    .select(EDGE_SELECT)
    .single();

  // 23505 = the least/greatest pair index — this pair already exists on this
  // board (possibly drawn the other way round). The client treats it as "the
  // edge is already there", not a failure.
  if (error?.code === "23505") {
    return NextResponse.json({ error: "duplicate" }, { status: 409 });
  }
  // 42P01 = undefined_table — migration 20260818000001 not pushed yet. The
  // reader degrades to an empty list on the same code; a write cannot, so it
  // says so rather than reporting a phantom success.
  if (error?.code === "42P01") {
    return NextResponse.json({ error: "edges are not available yet" }, { status: 503 });
  }
  if (error || !row) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

  return NextResponse.json(rowToEdge(row));
}
