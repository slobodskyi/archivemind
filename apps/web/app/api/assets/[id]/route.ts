import { NextResponse } from "next/server";
import { uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** DELETE /api/assets/[id] — soft delete (TECH_SPEC §12: user delete →
 *  status='deleted'; the DB trigger stamps deleted_at and the 30-day purge is
 *  the worker's job — ADR 0033). RLS scopes the update (assets_update =
 *  is_editor). The canvas now moves selections through the bulk
 *  POST /api/assets/delete; this single-id form stays for the drawer and any
 *  external caller. */
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
