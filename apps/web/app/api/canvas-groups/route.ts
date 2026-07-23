import { NextResponse } from "next/server";
import { artboardSettingsSchema, createCanvasGroupRequestSchema, type CanvasGroup } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { detachFromSiblingFolders, getCanvasGroups, nextGroupSortIndex } from "@/lib/canvas-groups";

/** Canvas groups — folders + artboards (ADR 0034). RLS scopes every query to
 *  the caller's workspace.
 *
 *  GET  ?project=<id|all> — the groups (with ordered members) the canvas hydrates.
 *  POST — create a folder/artboard; `assetIds` seeds membership. For a folder,
 *         those assets are detached from any other folder in the same scope
 *         (single-membership, enforced here, not in the DB). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = new URL(request.url).searchParams.get("project") ?? "all";
  const groups = await getCanvasGroups(supabase, scope);
  return NextResponse.json({ groups });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = createCanvasGroupRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { kind, name } = parsed.data;
  const projectId = parsed.data.projectId ?? null;

  // A project-scoped group's project must be visible to the caller (RLS).
  if (projectId) {
    const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const sortIndex = await nextGroupSortIndex(supabase, { projectId, kind });
  const rowSettings = kind === "artboard" ? artboardSettingsSchema.parse(parsed.data.settings ?? {}) : {};

  const { data: group, error: insErr } = await supabase
    .from("canvas_groups")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      kind,
      name,
      sort_index: sortIndex,
      settings: rowSettings,
      created_by: user.id,
    })
    .select("id, kind, name, project_id, sort_index, settings")
    .single();
  if (insErr || !group) {
    return NextResponse.json({ error: insErr?.message ?? "insert failed" }, { status: 500 });
  }

  // Seed membership. Keep only assets the caller can see + active, in request order.
  let members: string[] = [];
  if (parsed.data.assetIds.length > 0) {
    const { data: owned, error: ownedErr } = await supabase
      .from("assets")
      .select("id")
      .in("id", parsed.data.assetIds)
      .eq("status", "active");
    if (ownedErr) return NextResponse.json({ error: ownedErr.message }, { status: 500 });
    const ownedSet = new Set((owned ?? []).map((a) => a.id as string));
    const assetIds = parsed.data.assetIds.filter((aid) => ownedSet.has(aid));
    if (assetIds.length > 0) {
      if (kind === "folder") {
        await detachFromSiblingFolders(supabase, { projectId, exceptGroupId: group.id as string, assetIds });
      }
      const rows = assetIds.map((assetId, i) => ({
        group_id: group.id as string,
        asset_id: assetId,
        position: i,
        added_by: user.id,
      }));
      const { error: linkErr } = await supabase
        .from("canvas_group_assets")
        .upsert(rows, { onConflict: "group_id,asset_id", ignoreDuplicates: true });
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
      members = assetIds;
    }
  }

  const body: CanvasGroup = {
    id: group.id as string,
    kind: group.kind as CanvasGroup["kind"],
    name: group.name as string,
    projectId: group.project_id as string | null,
    sortIndex: group.sort_index as number,
    settings: kind === "artboard" ? artboardSettingsSchema.parse(group.settings ?? {}) : null,
    members,
  };
  return NextResponse.json(body);
}
