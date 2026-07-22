import { NextResponse } from "next/server";
import { editAssetRequestSchema, isIdentityRecipe, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** Image editing (ADR 0030), non-destructive. RLS scopes every query to the
 *  caller's workspace.
 *
 *  POST   — enqueue an 'edit' job for one asset: the worker renders fresh edited
 *           previews from the asset's ORIGINAL medium preview (no original bytes,
 *           source-agnostic) and writes the asset_edits row.
 *  GET    — the current recipe (so re-opening the editor resumes the last edit),
 *           or null.
 *  DELETE — reset: drop the asset_edits row (editors only). Instant, no worker —
 *           asset_previews (the originals) were never touched, so the views snap
 *           back on the next refresh. The orphaned edited R2 objects are reclaimed
 *           by a re-edit (stable keys) or the asset-delete purge, like other
 *           derivatives (see /api/assets/[id]). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid asset id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = editAssetRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  // An identity recipe would enqueue a paid render that changes nothing.
  if (isIdentityRecipe(parsed.data.recipe)) {
    return NextResponse.json({ error: "empty edit" }, { status: 400 });
  }

  // The asset must exist, be active, and already have a medium preview — the
  // render source. RLS scopes both reads to the caller's workspace.
  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .select("id")
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });
  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  const { data: preview, error: prevErr } = await supabase
    .from("asset_previews")
    .select("asset_id")
    .eq("asset_id", id)
    .eq("size", "medium")
    .maybeSingle();
  if (prevErr) return NextResponse.json({ error: prevErr.message }, { status: 500 });
  if (!preview) return NextResponse.json({ error: "asset has no preview to edit yet" }, { status: 409 });

  const { data: jobRow, error: jobErr } = await supabase
    .from("ai_jobs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      type: "edit",
      payload: { asset_id: id, recipe: parsed.data.recipe },
      total_items: 1,
      done_items: 0,
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  return NextResponse.json({ jobId: jobRow.id as string });
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid asset id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("asset_edits")
    .select("recipe")
    .eq("asset_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recipe: data?.recipe ?? null });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid asset id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // RLS asset_edits_delete = is_editor_of_asset: a viewer or an outsider deletes
  // zero rows (no error), an editor drops their own asset's edit.
  const { error } = await supabase.from("asset_edits").delete().eq("asset_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
