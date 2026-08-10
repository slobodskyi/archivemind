import { NextResponse } from "next/server";
import {
  createTopicRequestSchema,
  createTopicResponseSchema,
  topicsResponseSchema,
  topicSummarySchema,
} from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { topicRpcError } from "./rpc-error";

/** GET /api/topics — every usable destination in the current workspace.
 *
 * A project canvas may show only a subset of the archive, but Move to topic
 * must still reach the workspace's other topics. Generated rows are listed
 * while non-empty; an empty row remains listable when it carries a human name
 * or an override. Manual rows are human-owned and always listed until deleted.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const [clustersResult, overridesResult] = await Promise.all([
    supabase
      .from("topic_clusters")
      .select("id, label, origin, size, is_renamed")
      .eq("workspace_id", workspaceId)
      .order("label", { ascending: true }),
    supabase.from("topic_cluster_overrides").select("cluster_id").eq("workspace_id", workspaceId),
  ]);
  if (clustersResult.error) return topicRpcError(clustersResult.error);
  if (overridesResult.error) return topicRpcError(overridesResult.error);

  const referenced = new Set((overridesResult.data ?? []).map((row) => row.cluster_id as string));
  const topics = (clustersResult.data ?? [])
    .filter(
      (row) =>
        row.origin === "manual" ||
        (row.size as number) > 0 ||
        row.is_renamed === true ||
        referenced.has(row.id as string),
    )
    .map((row) =>
      topicSummarySchema.parse({ id: row.id, label: row.label, origin: row.origin }),
    );

  return NextResponse.json(topicsResponseSchema.parse({ topics }));
}

/** POST /api/topics — create a manual topic and assign the selection to it in
 * one database transaction. Workspace is server-resolved, never accepted from
 * the body; the SECURITY DEFINER RPC independently checks editor membership. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = createTopicRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data, error } = await supabase
    .rpc("create_manual_topic", {
      p_workspace_id: workspaceId,
      p_label: parsed.data.label,
      p_asset_ids: parsed.data.assetIds,
    })
    .single();
  if (error) return topicRpcError(error);

  const row = data as { topic_id: unknown; topic_label: unknown } | null;
  if (!row) return NextResponse.json({ error: "topic was not created" }, { status: 500 });
  const body = createTopicResponseSchema.parse({
    topic: { id: row.topic_id, label: row.topic_label },
  });
  return NextResponse.json(body, { status: 201 });
}
