import { NextResponse } from "next/server";
import { patchFactRequestSchema, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** PATCH /api/facts/[id] — record a human verdict on one AI-extracted fact.
 *
 *  This is not bookkeeping: `caption.ts` prompts with
 *  `select text from facts where asset_id = $1 and status = 'confirmed'`, so a
 *  confirmed fact is the only user-supplied ground truth that reaches caption
 *  generation. Until this route existed nothing could set that status, the
 *  query always came back empty, and every caption was written without the
 *  fact context its prompt is built around.
 *
 *  Confirming stamps who did it and when (the columns have been in the schema
 *  since the initial migration); moving a fact back off 'confirmed' clears both
 *  so the audit trail never outlives the claim it certified. RLS scopes the
 *  update — facts_update = is_editor_of_asset. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid fact id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = patchFactRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const confirmed = parsed.data.status === "confirmed";
  // confirmed_by references profiles(id). Every user who reaches here has one:
  // getCurrentWorkspaceId requires a membership, and the only thing that
  // creates a membership is ensureWorkspace(), which upserts the profile first.
  // A future invite flow that inserts a membership WITHOUT a profile would
  // break that assumption and this FK with it.
  const { data: row, error } = await supabase
    .from("facts")
    .update({
      status: parsed.data.status,
      confirmed_by: confirmed ? user.id : null,
      confirmed_at: confirmed ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("id, text, status")
    // maybeSingle, not single: RLS hides another workspace's fact rather than
    // erroring, and a stale drawer can hold a purged id — both are "not found",
    // not a server fault.
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "fact not found" }, { status: 404 });

  return NextResponse.json(row);
}
