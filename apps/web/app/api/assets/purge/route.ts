import { NextResponse } from "next/server";
import { assetIdsRequestSchema, purgeJobPayloadSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** POST /api/assets/purge — "Delete permanently" / "Empty trash" (ADR 0033).
 *  Only enqueues: the worker's purge handler erases the R2 bytes + DB
 *  derivatives and stamps purged_at (keeping the asset row as a dedup
 *  tombstone). Only un-purged TRASH is eligible — an active asset can never be
 *  purged directly, so a stray id in the body is a no-op, not a data loss.
 *  RLS scopes the read (assets_select) and the enqueue (ai_jobs_insert =
 *  is_editor). The handler re-checks status at run time, so a restore that
 *  races this enqueue wins. */
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

  const { data: rows, error } = await supabase
    .from("assets")
    .select("id, workspace_id")
    .in("id", parsed.data.ids)
    .eq("status", "deleted")
    .is("purged_at", null);
  if (error) {
    // 42703 = trash-retention migration (20260723000001) not applied yet; the
    // purge machinery doesn't exist on this DB, so there is nothing to enqueue.
    if (error.code === "42703") return NextResponse.json({ error: "purge unavailable" }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "no matching trashed assets" }, { status: 404 });
  }

  // Dual-membership callers can hold trash in several workspaces — one purge
  // job per workspace, mirroring the sweep's own grouping.
  const byWorkspace = new Map<string, string[]>();
  for (const r of rows) {
    const ws = r.workspace_id as string;
    byWorkspace.set(ws, [...(byWorkspace.get(ws) ?? []), r.id as string]);
  }

  for (const [workspaceId, assetIds] of byWorkspace) {
    const { error: jobErr } = await supabase.from("ai_jobs").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      type: "purge",
      payload: purgeJobPayloadSchema.parse({ asset_ids: assetIds }),
      total_items: assetIds.length,
      done_items: 0,
    });
    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  return NextResponse.json({ enqueued: rows.length });
}
