import { NextResponse } from "next/server";
import { boardAssetsRequestSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** Membership of one Workspace (ADR 0044).
 *
 *  POST   — add assets. New members append after the current max position.
 *  DELETE — remove them; the assets themselves are untouched, a workspace is a
 *           subset and not a container of bytes.
 *
 *  A photo can sit in several workspaces, so there is no sibling-detach here —
 *  that rule belongs to folders (ADR 0034), where single-membership is the point. */
async function loadBoard(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from("boards").select("id").eq("id", id).maybeSingle();
  return data;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = boardAssetsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!(await loadBoard(supabase, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Keep only what the caller can see and what is still active. Pre-filtering,
  // not error-handling: an RLS WITH CHECK violation raises on the whole INSERT,
  // so one stale id would reject the entire add.
  const { data: owned, error: ownedErr } = await supabase
    .from("assets")
    .select("id")
    .in("id", parsed.data.assetIds)
    .eq("status", "active");
  if (ownedErr) return NextResponse.json({ error: ownedErr.message }, { status: 500 });
  const ownedSet = new Set((owned ?? []).map((a) => a.id as string));
  const visible = parsed.data.assetIds.filter((aid) => ownedSet.has(aid));
  if (visible.length === 0) return NextResponse.json({ added: [] });

  const { data: last } = await supabase
    .from("board_assets")
    .select("position")
    .eq("board_id", id)
    .order("position", { ascending: false })
    .limit(1);
  const base = last && last.length > 0 ? (last[0].position as number) + 1 : 0;

  const { error: linkErr } = await supabase.from("board_assets").upsert(
    visible.map((assetId, i) => ({
      board_id: id,
      asset_id: assetId,
      position: base + i,
      added_by: user.id,
    })),
    { onConflict: "board_id,asset_id", ignoreDuplicates: true },
  );
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
  return NextResponse.json({ added: visible });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = boardAssetsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!(await loadBoard(supabase, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await supabase
    .from("board_assets")
    .delete()
    .eq("board_id", id)
    .in("asset_id", parsed.data.assetIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ removed: parsed.data.assetIds });
}
