import { NextResponse } from "next/server";
import {
  createExportRequestSchema,
  exportResultSchema,
  uuidSchema,
  type ExportResult,
} from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** Artboard / selection → PDF export (ADR 0035). POST enqueues an 'export' job
 *  (the worker renders the PDF into R2 and writes payload.result_url); GET polls
 *  that URL once Realtime reports the job done. RLS scopes every query. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = createExportRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  let projectId: string | null = null;
  let payload: Record<string, unknown>;

  if (parsed.data.groupId) {
    // Export a saved artboard/folder — confirm it's visible + take its scope.
    const { data: group, error: gErr } = await supabase
      .from("canvas_groups")
      .select("id, project_id")
      .eq("id", parsed.data.groupId)
      .maybeSingle();
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
    if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });
    projectId = (group.project_id as string | null) ?? null;
    payload = { group_id: parsed.data.groupId, options: parsed.data.options };
  } else {
    // Ad-hoc selection — keep only active, visible assets, preserving order.
    const ids = parsed.data.assetIds ?? [];
    const { data: owned, error: oErr } = await supabase
      .from("assets")
      .select("id")
      .in("id", ids)
      .eq("status", "active");
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
    const ownedSet = new Set((owned ?? []).map((a) => a.id as string));
    const assetIds = ids.filter((aid) => ownedSet.has(aid));
    if (assetIds.length === 0) return NextResponse.json({ error: "no matching assets" }, { status: 404 });
    payload = { asset_ids: assetIds, options: parsed.data.options };
  }

  const { data: jobRow, error: jobErr } = await supabase
    .from("ai_jobs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      project_id: projectId,
      type: "export",
      payload,
      total_items: 1,
      done_items: 0,
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  return NextResponse.json({ jobId: jobRow.id as string });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!uuidSchema.safeParse(jobId).success) {
    return NextResponse.json({ error: "invalid job id" }, { status: 400 });
  }

  const { data: job, error } = await supabase
    .from("ai_jobs")
    .select("id, status, payload")
    .eq("id", jobId)
    .eq("type", "export")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "export not found" }, { status: 404 });

  const payload = (job.payload ?? {}) as { result_url?: unknown };
  const url = typeof payload.result_url === "string" ? payload.result_url : null;
  const body: ExportResult = {
    jobId: job.id as string,
    status: exportResultSchema.shape.status.parse(job.status),
    url,
  };
  return NextResponse.json(body);
}
