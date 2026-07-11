import { NextResponse } from "next/server";
import { addProjectAssetsRequestSchema, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** POST /api/projects/[id]/assets (spec §9, issue #17) — M:N link assets into
 *  a project. RLS scopes both sides (project_assets_insert = is_editor_of_asset
 *  AND is_editor of the project's workspace). Idempotent: on-conflict ignore. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid project id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = addProjectAssetsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  // Project must be visible to the caller (RLS); confirm before inserting links.
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();
  if (projErr || !project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  // Keep only assets the caller can actually see (RLS scopes this select).
  const { data: owned, error: ownedErr } = await supabase
    .from("assets")
    .select("id")
    .in("id", parsed.data.assetIds)
    .eq("status", "active");
  if (ownedErr) return NextResponse.json({ error: ownedErr.message }, { status: 500 });
  const assetIds = (owned ?? []).map((a) => a.id as string);
  if (assetIds.length === 0) return NextResponse.json({ error: "no matching assets" }, { status: 404 });

  const rows = assetIds.map((assetId) => ({
    project_id: id,
    asset_id: assetId,
    added_by: user.id,
  }));
  const { error: linkErr } = await supabase
    .from("project_assets")
    .upsert(rows, { onConflict: "project_id,asset_id", ignoreDuplicates: true });
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  return NextResponse.json({ added: assetIds.length });
}
