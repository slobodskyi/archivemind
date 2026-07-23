import { NextResponse } from "next/server";
import { assetIdsRequestSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** POST /api/assets/restore — bulk un-delete (ADR 0033): the undo toast and
 *  the Trash view's Restore both land here. Only un-purged trash comes back —
 *  a purged tombstone has no bytes left to show, so restoring it would render
 *  a broken tile (its way back is re-importing the file, which re-ingests).
 *  The DB trigger clears deleted_at/purged_at on the status flip; RLS scopes
 *  the update (assets_update = is_editor). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = assetIdsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  let { data, error } = await supabase
    .from("assets")
    .update({ status: "active" })
    .in("id", parsed.data.ids)
    .eq("status", "deleted")
    .is("purged_at", null)
    .select("id");
  if (error?.code === "42703") {
    // Trash-retention migration (20260723000001) not applied yet — before it,
    // nothing can be purged, so the guard is vacuous: restore by status alone.
    ({ data, error } = await supabase
      .from("assets")
      .update({ status: "active" })
      .in("id", parsed.data.ids)
      .eq("status", "deleted")
      .select("id"));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ restored: (data ?? []).map((r) => r.id as string) });
}
