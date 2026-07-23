import { NextResponse } from "next/server";
import { assetIdsRequestSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** POST /api/assets/delete — bulk soft delete (ADR 0033). One request moves a
 *  whole selection to the Trash (status='deleted'; the DB trigger stamps
 *  deleted_at), replacing the old per-id DELETE fan-out so a multi-select
 *  delete is one round-trip and one consistent outcome. RLS scopes the update
 *  (assets_update = is_editor); ids outside the caller's workspaces are
 *  silently unaffected. The 30-day purge is the worker's job, not this
 *  request's. */
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

  const { data, error } = await supabase
    .from("assets")
    .update({ status: "deleted" })
    .in("id", parsed.data.ids)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: (data ?? []).map((r) => r.id as string) });
}
