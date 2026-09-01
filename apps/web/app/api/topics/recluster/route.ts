import { NextResponse } from "next/server";
import { clusterJobPayloadSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** POST /api/topics/recluster — re-run the semantic clustering on demand
 *  (ADR 0038).
 *
 *  NO UI ENTRY POINT since 2026-09-01: the Re-cluster button was removed from
 *  `SortingActionBar` (ADR 0038's amendment). The route is kept deliberately —
 *  it grants no privilege an editor lacks, and it makes bringing the button
 *  back a UI change rather than a rebuild. Do not "restore" a caller for it as
 *  if this were a bug.
 *
 *  ADR 0028 enqueued `cluster` only at the tail of an analyze run, which meant
 *  that after deleting or adding photos the Topic clouds could only be refreshed
 *  by paying for an analyze the user did not want. This route removes that
 *  corner. It grants no new database privilege: `ai_jobs_insert` is
 *  `is_editor(workspace_id)` with no restriction on `type`, so an editor could
 *  already insert a cluster job straight at PostgREST — the refusal was in zod
 *  alone.
 *
 *  It is its own route rather than an arm of `createJobRequestSchema` because
 *  every arm of that union is asset-id-shaped and `POST /api/jobs` reads
 *  `assetIds` unconditionally. A workspace-scoped job gets its own route here,
 *  exactly as `edit`, `purge` and `export` do.
 *
 *  Costs zero credits: the handler is pure CPU over embeddings analyze already
 *  stored and makes no Gemini call, so exposing it does not spend the user's
 *  money and keeps the "AI only by button" rule intact from both directions. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  // Backlog guard, same shape as POST /api/exports. The worker claims ONE job
  // at a time with no per-type lanes and serves every workspace, so a user
  // holding the button down could starve ingest and analyze deployment-wide.
  // Unlike the analyze tail's guard this counts 'running' too: a second run
  // started while the first is mid-flight would only block on the same
  // advisory lock and then redo identical work.
  const { count: inFlight, error: countErr } = await supabase
    .from("ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("type", "cluster")
    .in("status", ["queued", "running"]);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((inFlight ?? 0) > 0) {
    return NextResponse.json({ error: "cluster_in_flight" }, { status: 429 });
  }

  // The payload's workspace is built from the caller's server-resolved
  // membership, NEVER from the request body. RLS validates the row's
  // workspace_id column, not the JSON inside `payload`, and the worker runs
  // that payload as `postgres` with RLS bypassed — a caller-supplied
  // workspace_id would be a cross-tenant read and delete primitive.
  const payload = clusterJobPayloadSchema.parse({ workspace_id: workspaceId });

  const { data: jobRow, error: jobErr } = await supabase
    .from("ai_jobs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      type: "cluster",
      payload,
      total_items: 1,
      done_items: 0,
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  return NextResponse.json({ jobId: jobRow.id as string });
}
