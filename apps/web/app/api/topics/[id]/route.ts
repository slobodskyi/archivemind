import { NextResponse } from "next/server";
import { renameTopicClusterRequestSchema, topicMutationResponseSchema, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { topicRpcError } from "../rpc-error";

/** PATCH /api/topics/[id] — rename one Topic cloud (ADR 0038).
 *
 *  ADR 0028 names a cluster after its two most discriminative tags, which is
 *  enough to navigate by and never the name the archive's owner would have
 *  chosen. No heuristic will name every pile correctly, so the escape hatch is
 *  the user's own: double-click a cloud's label on the Topic canvas.
 *
 *  The update body is EXACTLY `{ label, is_renamed }` and must stay that way.
 *  `topic_clusters` carries the k-means centroid, so migration
 *  20260727000003 revoked the blanket UPDATE grant and re-granted only those
 *  two columns — Postgres checks column privileges against the statement's SET
 *  list, so one extra key here (including `updated_at`, which the BEFORE
 *  trigger sets on its own) turns the whole request into a 42501. That is
 *  stricter than the captions/facts routes this one otherwise mirrors.
 *
 *  `is_renamed` is what stops the next cluster run from overwriting the name:
 *  the worker leaves a pinned label alone and no longer deletes such a cluster
 *  when its centroid stops matching. Setting it is therefore the point of the
 *  write, not a side effect. RLS scopes the row — topic_clusters_update =
 *  is_editor(workspace_id). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid cluster id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = renameTopicClusterRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from("topic_clusters")
    .update({ label: parsed.data.label, is_renamed: true })
    .eq("id", id)
    .select("id, label, is_renamed")
    // maybeSingle, not single: RLS hides another workspace's cluster and makes
    // a viewer's write affect zero rows rather than erroring, and a re-cluster
    // can retire the id a stale canvas is still holding — all "not found", not
    // a server fault.
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "topic not found" }, { status: 404 });

  return NextResponse.json(row);
}

/** DELETE /api/topics/[id] — delete a human-created topic (ADR 0042).
 *
 * The RPC deletes the manual row and its overrides atomically, so every member
 * immediately falls back to its untouched assets.cluster_id AI baseline. A
 * generated topic is worker-owned and deliberately returns not-found here. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid cluster id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const { data: deleted, error } = await supabase.rpc("delete_manual_topic", {
    p_workspace_id: workspaceId,
    p_cluster_id: id,
  });
  if (error) return topicRpcError(error);
  if (deleted !== true) return NextResponse.json({ error: "topic not found" }, { status: 404 });

  return NextResponse.json(topicMutationResponseSchema.parse({ ok: true }));
}
