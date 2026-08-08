import { NextResponse } from "next/server";
import { setAssetLabelRequestSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** POST /api/assets/label — set or clear the colour label on a selection
 *  (migration 20260808000001). Bulk-first like the trash routes: marking 40
 *  picks is one request and one undoable outcome, not 40.
 *
 *  RLS is the whole authorization story — assets_update is is_editor, so ids
 *  from another workspace simply do not match and come back unaffected. The
 *  response echoes the ids that DID change so the client can reconcile rather
 *  than assume; a partial match is not an error (it is what a stale canvas
 *  looks like after someone else deleted a photo).
 *
 *  Deliberately not an ai_jobs type and deliberately not metered: no model runs
 *  and nothing is generated, so it costs 0 credits (packages/shared/src/usage.ts
 *  — a credit is one AI action on one photo). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = setAssetLabelRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("assets")
    .update({ label: parsed.data.label })
    .in("id", parsed.data.ids)
    // A trashed photo keeps whatever label it had — restoring it should bring
    // its colour back — but it must not be re-labelled from a canvas that no
    // longer shows it.
    .eq("status", "active")
    .select("id");
  // Migration not pushed yet (see lib/assets.ts's matching fallback): 42703 =
  // undefined_column. Fail loudly here — unlike a read, silently dropping a
  // write would leave the user staring at a dot that never persists.
  if (error?.code === "42703") {
    return NextResponse.json({ error: "labels are not available yet" }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ updated: (data ?? []).map((r) => r.id as string) });
}
