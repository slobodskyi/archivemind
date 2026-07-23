import { NextResponse } from "next/server";
import { groupAssetsRequestSchema, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { detachFromSiblingFolders } from "@/lib/canvas-groups";

/** POST /api/canvas-groups/[id]/assets — add members (append after the current
 *  max position; folder-exclusivity applied). DELETE — remove members. RLS
 *  scopes both to the caller's own groups + assets. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = groupAssetsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  // The group must be visible to the caller (RLS); its kind + scope drive
  // folder-exclusivity below.
  const { data: group, error: groupErr } = await supabase
    .from("canvas_groups")
    .select("id, kind, project_id")
    .eq("id", id)
    .maybeSingle();
  if (groupErr) return NextResponse.json({ error: groupErr.message }, { status: 500 });
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  // Keep only assets the caller can see + active, preserving request order.
  const { data: owned, error: ownedErr } = await supabase
    .from("assets")
    .select("id")
    .in("id", parsed.data.assetIds)
    .eq("status", "active");
  if (ownedErr) return NextResponse.json({ error: ownedErr.message }, { status: 500 });
  const ownedSet = new Set((owned ?? []).map((a) => a.id as string));
  const assetIds = parsed.data.assetIds.filter((aid) => ownedSet.has(aid));
  if (assetIds.length === 0) return NextResponse.json({ error: "no matching assets" }, { status: 404 });

  if (group.kind === "folder") {
    await detachFromSiblingFolders(supabase, {
      projectId: (group.project_id as string | null) ?? null,
      exceptGroupId: id,
      assetIds,
    });
  }

  // Append after the current max position; skip assets already in the group so
  // re-dropping a member never reshuffles it.
  const { data: existing, error: exErr } = await supabase
    .from("canvas_group_assets")
    .select("asset_id, position")
    .eq("group_id", id);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const existingIds = new Set((existing ?? []).map((r) => r.asset_id as string));
  const maxPos = (existing ?? []).reduce((m, r) => Math.max(m, r.position as number), -1);
  const toAdd = assetIds.filter((aid) => !existingIds.has(aid));

  if (toAdd.length > 0) {
    const rows = toAdd.map((assetId, i) => ({
      group_id: id,
      asset_id: assetId,
      position: maxPos + 1 + i,
      added_by: user.id,
    }));
    const { error: linkErr } = await supabase
      .from("canvas_group_assets")
      .upsert(rows, { onConflict: "group_id,asset_id", ignoreDuplicates: true });
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
  }

  return NextResponse.json({ added: toAdd.length });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = groupAssetsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: removed, error } = await supabase
    .from("canvas_group_assets")
    .delete()
    .eq("group_id", id)
    .in("asset_id", parsed.data.assetIds)
    .select("asset_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ removed: (removed ?? []).length });
}
