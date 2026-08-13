import { NextResponse } from "next/server";
import { patchBoardRequestSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** One Workspace (ADR 0044).
 *
 *  PATCH  — rename / recolour / reorder, and the trash pair: `deleted: true`
 *           moves it to Trash, `deleted: false` restores it. This is what the
 *           chip's × does now. Nothing else changes: membership stays, and so
 *           do the `board_id`s of the notes and folders made inside it, which is
 *           what makes the restore whole rather than a name coming back to an
 *           empty canvas.
 *  DELETE — the PERMANENT one, reachable only from the Trash panel. Here the FK
 *           side-effects finally run: membership rows cascade; the assets
 *           survive, and so do the notes, folders and artboards, whose
 *           `board_id` is set null — the same thing as "belongs to the project
 *           canvas". Deleting a workspace must never delete work.
 *
 *  RLS decides visibility, so a caller who cannot see the row gets a 404 from
 *  the same query that would have updated it — never a "forbidden" that
 *  confirms the id exists in someone else's workspace. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchBoardRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;
  // The trash pair, stamped server-side: `deleted_at` decides when the 30-day
  // sweep claims the row, so the clock is the database's, never the browser's.
  if (parsed.data.deleted !== undefined) {
    patch.deleted_at = parsed.data.deleted ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase
    .from("boards")
    .update(patch)
    .eq("id", id)
    .select("id, project_id, name, color, sort_order, deleted_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: data.id,
    projectId: data.project_id,
    name: data.name,
    color: data.color,
    sortOrder: data.sort_order,
    // Membership is untouched by every field this route writes, so it is not
    // re-read here; the client already holds it (and after a restore, still
    // does — which is the point of the soft delete).
    assetIds: [],
    deletedAt: data.deleted_at ?? null,
  });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("boards").delete().eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
