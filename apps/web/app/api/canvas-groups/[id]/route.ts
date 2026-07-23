import { NextResponse } from "next/server";
import { artboardSettingsSchema, patchCanvasGroupRequestSchema, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** PATCH /api/canvas-groups/[id] — rename, reorder (artboards), or retune export
 *  settings. DELETE — drop the group (membership cascades; the assets survive, a
 *  group is a curated subset). RLS scopes both (canvas_groups_* = is_editor). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchCanvasGroupRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.sortIndex !== undefined) patch.sort_index = parsed.data.sortIndex;
  if (parsed.data.settings !== undefined) patch.settings = artboardSettingsSchema.parse(parsed.data.settings);

  const { data: row, error } = await supabase
    .from("canvas_groups")
    .update(patch)
    .eq("id", id)
    .select("id, name, sort_index, settings")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "group not found" }, { status: 404 });

  return NextResponse.json(row);
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.from("canvas_groups").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
