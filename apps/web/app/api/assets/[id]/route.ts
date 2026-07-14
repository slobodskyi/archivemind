import { NextResponse } from "next/server";
import { uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** DELETE /api/assets/[id] — soft delete (TECH_SPEC §12: user delete →
 *  status='deleted'; R2 derivative purge is a background job, not this
 *  request). RLS scopes the update (assets_update = is_editor). Any view's
 *  photo tile can call this — it isn't project- or view-specific. */
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

  const { data: row, error } = await supabase
    .from("assets")
    .update({ status: "deleted" })
    .eq("id", id)
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
