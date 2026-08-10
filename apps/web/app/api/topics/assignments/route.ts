import { NextResponse } from "next/server";
import { assignTopicAssetsRequestSchema, topicMutationResponseSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { topicRpcError } from "../rpc-error";

/** PUT /api/topics/assignments — batch move or Return to AI (ADR 0042).
 *
 * `clusterId` pins a manual effective assignment without changing the latest
 * k-means answer in assets.cluster_id. `null` removes that override. The SQL
 * RPC validates the entire selection and target before changing anything, so
 * this is one undoable outcome rather than a partial fan-out of N requests. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = assignTopicAssetsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const { error } = await supabase.rpc("assign_topic_assets", {
    p_workspace_id: workspaceId,
    p_asset_ids: parsed.data.assetIds,
    p_cluster_id: parsed.data.clusterId,
  });
  if (error) return topicRpcError(error);

  return NextResponse.json(topicMutationResponseSchema.parse({ ok: true }));
}
