import { NextResponse } from "next/server";
import { createBoardRequestSchema, type Board } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { getBoards, nextBoardSortOrder } from "@/lib/boards-server";

/** Workspaces — ADR 0044. "Workspace" in the UI, `board` in the code, because
 *  `workspace_id` already means the tenant. RLS scopes every query to the
 *  caller's workspace; nothing here trusts a workspace id from the body.
 *
 *  GET  ?project=<id> — the project's workspaces with their ordered members,
 *       trashed ones included and marked by `deletedAt` (the client splits them
 *       — the header needs to know there is something to restore).
 *  POST — create one; `assetIds` seeds membership, so "new workspace from this
 *         selection" is a single request. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get("project");
  // Unlike canvas groups there is no 'all' scope: a workspace is a subset of one
  // project, and the all-files grid has no browser to open one from.
  if (!projectId || projectId === "all") return NextResponse.json({ boards: [] });

  const boards = await getBoards(supabase, projectId);
  return NextResponse.json({ boards });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = createBoardRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { projectId, name, color, assetIds } = parsed.data;

  // The project must be visible to the caller (RLS decides that, not us).
  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const sortOrder = await nextBoardSortOrder(supabase, projectId);

  const { data: row, error: insErr } = await supabase
    .from("boards")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      name,
      color: color ?? "blue",
      sort_order: sortOrder,
      created_by: user.id,
    })
    .select("id, project_id, name, color, sort_order")
    .single();
  if (insErr || !row) {
    return NextResponse.json({ error: "could not create the workspace" }, { status: 500 });
  }

  // Seed membership, keeping only assets the caller can actually see and that
  // are still active, in request order. Pre-filtering matters: an RLS WITH CHECK
  // violation raises on the whole INSERT rather than dropping the offending row,
  // so one stale id from a client would otherwise fail the entire create.
  let seeded: string[] = [];
  if (assetIds.length > 0) {
    const { data: owned, error: ownedErr } = await supabase
      .from("assets")
      .select("id")
      .in("id", assetIds)
      .eq("status", "active");
    if (ownedErr) return NextResponse.json({ error: ownedErr.message }, { status: 500 });
    const ownedSet = new Set((owned ?? []).map((a) => a.id as string));
    const visible = assetIds.filter((id) => ownedSet.has(id));
    if (visible.length > 0) {
      const { error: linkErr } = await supabase
        .from("board_assets")
        .upsert(
          visible.map((assetId, position) => ({
            board_id: row.id as string,
            asset_id: assetId,
            position,
            added_by: user.id,
          })),
          { onConflict: "board_id,asset_id", ignoreDuplicates: true },
        );
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
      seeded = visible;
    }
  }

  const board: Board = {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    assetIds: seeded,
    deletedAt: null,
  };
  return NextResponse.json(board, { status: 201 });
}
