import { NextResponse } from "next/server";
import {
  EXPORT_MAX_ASSETS,
  EXPORT_MAX_IN_FLIGHT,
  createExportRequestSchema,
  exportFilename,
  exportResultSchema,
  uuidSchema,
  type ExportResult,
} from "@archivemind/shared";
import { presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** Artboard / selection → PDF export (ADR 0035). POST enqueues an 'export' job
 *  (the worker renders the PDF into R2 and writes payload.result_key); GET polls
 *  the job and presigns that key per request once Realtime reports it done, so no
 *  bearer URL is ever stored or broadcast. RLS scopes every query.
 *
 *  Failures answer with a machine-readable `error` code from
 *  EXPORT_ERROR_CODES — the dialog maps it to copy, because every distinct
 *  failure used to collapse into "Couldn't start the export." */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = createExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    // A selection over the cap is the one invalid request users hit by accident
    // (the client only ever loads 500 rows, so "export everything" lands here);
    // it deserves its own code rather than a generic 400 the dialog can't explain.
    const overCap =
      Array.isArray((body as { assetIds?: unknown } | null)?.assetIds) &&
      ((body as { assetIds: unknown[] }).assetIds.length > EXPORT_MAX_ASSETS);
    return NextResponse.json(
      { error: overCap ? "too_many_assets" : "invalid_request", limit: EXPORT_MAX_ASSETS, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  let projectId: string | null = null;
  let payload: Record<string, unknown>;
  // How many assets the job will actually render. The dialog shows the count it
  // asked for, which silently overstates when trashed or foreign ids were dropped.
  let accepted: number | null = null;

  if (parsed.data.groupId) {
    // Export a saved artboard/folder — confirm it's visible + take its scope.
    const { data: group, error: gErr } = await supabase
      .from("canvas_groups")
      .select("id, project_id")
      .eq("id", parsed.data.groupId)
      .maybeSingle();
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
    if (!group) return NextResponse.json({ error: "group_not_found" }, { status: 404 });
    projectId = (group.project_id as string | null) ?? null;
    payload = { group_id: parsed.data.groupId, options: parsed.data.options, title: parsed.data.title };
  } else {
    // Ad-hoc selection — keep only active, visible assets, preserving order.
    // Duplicates are collapsed: the same id repeated would otherwise render the
    // same photo once per occurrence (500 pages out of one owned asset).
    const ids = [...new Set(parsed.data.assetIds ?? [])];
    const { data: owned, error: oErr } = await supabase
      .from("assets")
      .select("id")
      .in("id", ids)
      .eq("status", "active");
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
    const ownedSet = new Set((owned ?? []).map((a) => a.id as string));
    const assetIds = ids.filter((aid) => ownedSet.has(aid));
    if (assetIds.length === 0) return NextResponse.json({ error: "no_matching_assets" }, { status: 404 });
    payload = { asset_ids: assetIds, options: parsed.data.options, title: parsed.data.title };
    accepted = assetIds.length;
  }

  // Cheap backlog guard, same shape as POST /api/imports. The worker claims and
  // awaits ONE job at a time with no per-type lanes, so an impatient user or a
  // retry loop could queue hundreds of 500-page exports and starve every ingest,
  // analyze and purge job in the deployment — for every workspace, since one
  // worker serves them all.
  const { count: inFlight } = await supabase
    .from("ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("type", "export")
    .in("status", ["queued", "running"]);
  if ((inFlight ?? 0) >= EXPORT_MAX_IN_FLIGHT) {
    return NextResponse.json({ error: "export_backlog" }, { status: 429 });
  }

  const { data: jobRow, error: jobErr } = await supabase
    .from("ai_jobs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      project_id: projectId,
      type: "export",
      payload,
      // Seed the real item count so the dialog's progress bar has a denominator
      // before the worker claims the job (it was hardcoded to 1).
      total_items: accepted ?? 1,
      done_items: 0,
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  return NextResponse.json({ jobId: jobRow.id as string, accepted });
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
    .select("id, status, payload, progress, progress_label, done_items, total_items, error")
    .eq("id", jobId)
    .eq("type", "export")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "export_not_found" }, { status: 404 });

  // Presign per request rather than echoing a stored URL. The worker writes only
  // the R2 key, so (a) no 7-day bearer URL sits in a row every workspace member
  // can read and that broadcasts on update, and (b) the link cannot rot — the old
  // stored URL died on day 8 while this route kept serving it with status 'done'
  // and no way to mint another. A cleared key means the retention sweep has
  // deleted the object, so there is deliberately nothing to offer.
  const payload = (job.payload ?? {}) as { result_key?: unknown; title?: unknown };
  const key = typeof payload.result_key === "string" ? payload.result_key : null;
  // Sign a human filename into the URL — the download used to save as the job's
  // uuid, because the presigned URL is cross-origin and the <a download>
  // attribute is ignored there.
  const url = key
    ? await presignGet(
        key,
        exportFilename(
          typeof payload.title === "string" ? payload.title : null,
          key.split(".").pop() ?? "pdf",
          new Date().toISOString(),
        ),
      )
    : null;
  const body: ExportResult = {
    jobId: job.id as string,
    status: exportResultSchema.shape.status.parse(job.status),
    url,
    progress: typeof job.progress === "number" ? job.progress : 0,
    progressLabel: typeof job.progress_label === "string" ? job.progress_label : null,
    doneItems: typeof job.done_items === "number" ? job.done_items : null,
    totalItems: typeof job.total_items === "number" ? job.total_items : null,
    error: typeof job.error === "string" ? job.error : null,
  };
  return NextResponse.json(body);
}
