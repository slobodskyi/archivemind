import { NextResponse } from "next/server";
import {
  assetKindFromMime,
  completeUploadRequestSchema,
  ingestJobPayloadSchema,
  type CompleteUploadResponse,
} from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** POST /api/uploads/complete (spec §9, v1.2): after the browser PUT, create
 *  asset + file rows (Asset ≠ File — ADR 0011) and enqueue ONE ingest job for
 *  the batch (spec §8.1: hashing/dedup/EXIF/previews happen in the worker).
 *  Every insert runs under the caller's RLS. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = completeUploadRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  // Guard: uploads must land inside the caller's own workspace prefix — a
  // forged r2Key can't attach foreign objects to this workspace.
  const foreign = parsed.data.uploads.find((u) => !u.r2Key.startsWith(`${workspaceId}/originals/`));
  if (foreign) {
    return NextResponse.json({ error: "r2Key outside workspace" }, { status: 400 });
  }

  const assetIds: string[] = [];
  for (const upload of parsed.data.uploads) {
    const { data: asset, error: assetErr } = await supabase
      .from("assets")
      .insert({
        workspace_id: workspaceId,
        added_by: user.id,
        kind: assetKindFromMime(upload.mime),
        title: upload.filename,
      })
      .select("id")
      .single();
    if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });

    const { error: fileErr } = await supabase.from("files").insert({
      asset_id: asset.id,
      workspace_id: workspaceId,
      origin: "upload",
      r2_key: upload.r2Key,
      mime_type: upload.mime,
      byte_size: upload.size,
    });
    if (fileErr) return NextResponse.json({ error: fileErr.message }, { status: 500 });
    assetIds.push(asset.id as string);
  }

  const { data: job, error: jobErr } = await supabase
    .from("ai_jobs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      type: "ingest",
      payload: ingestJobPayloadSchema.parse({ asset_ids: assetIds }),
      total_items: assetIds.length,
      done_items: 0,
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  const body: CompleteUploadResponse = { assetIds, jobId: job.id as string };
  return NextResponse.json(body);
}
