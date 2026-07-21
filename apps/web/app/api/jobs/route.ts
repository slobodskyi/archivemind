import { NextResponse } from "next/server";
import { analyzeJobPayloadSchema, captionJobPayloadSchema, createJobRequestSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** POST /api/jobs (spec §9) — the user-triggered AI entry point: analyze
 *  (#12), caption (#14), and ingest re-runs (#23 — heals Drive-linked assets
 *  after a failed download or a reconnect; the worker's resume guard makes
 *  repeats cheap). Export joins with its phase. RLS scopes the asset check
 *  and the insert to the caller's workspace. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = createJobRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  // Keep only assets the caller can actually see (RLS does the scoping).
  const { data: owned, error: ownedErr } = await supabase
    .from("assets")
    .select("id")
    .in("id", parsed.data.assetIds)
    .eq("status", "active");
  if (ownedErr) return NextResponse.json({ error: ownedErr.message }, { status: 500 });
  const assetIds = (owned ?? []).map((a) => a.id as string);
  if (assetIds.length === 0) {
    return NextResponse.json({ error: "no matching assets" }, { status: 404 });
  }

  // Caption progress counts asset × lang units; analyze/ingest count assets.
  // (analyze and ingest share the {asset_ids} payload shape — see shared.)
  const payload =
    parsed.data.type === "caption"
      ? captionJobPayloadSchema.parse({ asset_ids: assetIds, langs: parsed.data.langs, style: parsed.data.style })
      : analyzeJobPayloadSchema.parse({ asset_ids: assetIds });
  const totalItems =
    parsed.data.type === "caption" ? assetIds.length * parsed.data.langs.length : assetIds.length;

  const { data: jobRow, error: jobErr } = await supabase
    .from("ai_jobs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      type: parsed.data.type,
      payload,
      total_items: totalItems,
      done_items: 0,
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  return NextResponse.json({ jobId: jobRow.id as string, assetCount: assetIds.length });
}
