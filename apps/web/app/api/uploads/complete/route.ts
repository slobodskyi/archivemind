import { NextResponse } from "next/server";
import {
  completeUploadRequestSchema,
  completeUploadResponseSchema,
  completeUploadRpcResponseSchema,
} from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

interface UploadCompletionRpcError {
  code?: string;
  message?: string;
}

/** Keep Postgres diagnostics in server logs, never in the browser response. */
function rpcErrorResponse(
  error: UploadCompletionRpcError,
  trace: { batchId: string; chunk: string; completionId: string },
) {
  console.error("upload complete RPC failed", {
    ...trace,
    code: error.code ?? "unknown",
    message: error.message ?? "unknown",
  });

  if (error.code === "23505" && error.message?.includes("upload_completion_conflict")) {
    return NextResponse.json({ error: "upload completion conflict" }, { status: 409 });
  }
  if (error.code === "42501") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (error.code === "P0002") {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (error.code === "22023") {
    return NextResponse.json({ error: "invalid upload completion" }, { status: 400 });
  }
  return NextResponse.json({ error: "upload completion failed" }, { status: 500 });
}

/** POST /api/uploads/complete — authenticate and validate the browser payload,
 * then hand the whole completion to one atomic, idempotent database RPC. */
export async function POST(request: Request) {
  const batchId = request.headers.get("x-archivemind-upload-batch") ?? "untracked";
  const chunk = request.headers.get("x-archivemind-upload-chunk") ?? "unknown";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = completeUploadRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Reject a forged cross-workspace key before invoking the SECURITY DEFINER
  // RPC. The function repeats this check as its authoritative boundary.
  const foreign = parsed.data.uploads.find(
    (upload) => !upload.r2Key.startsWith(`${workspaceId}/originals/`),
  );
  if (foreign) {
    return NextResponse.json({ error: "r2Key outside workspace" }, { status: 400 });
  }

  const trace = { batchId, chunk, completionId: parsed.data.completionId };
  const { data, error } = await supabase
    .rpc("complete_upload_batch", {
      p_workspace_id: workspaceId,
      p_project_id: parsed.data.projectId ?? null,
      p_completion_id: parsed.data.completionId,
      p_uploads: parsed.data.uploads.map((upload) => ({
        r2_key: upload.r2Key,
        filename: upload.filename,
        mime: upload.mime,
        byte_size: upload.size,
      })),
    })
    .single();
  if (error) return rpcErrorResponse(error, trace);

  const rpcResult = completeUploadRpcResponseSchema.safeParse(data);
  if (!rpcResult.success || rpcResult.data.asset_ids.length !== parsed.data.uploads.length) {
    console.error("upload complete RPC returned malformed data", {
      ...trace,
      expectedAssets: parsed.data.uploads.length,
    });
    return NextResponse.json({ error: "upload completion failed" }, { status: 500 });
  }

  const body = completeUploadResponseSchema.parse({
    assetIds: rpcResult.data.asset_ids,
    jobId: rpcResult.data.job_id,
  });
  console.info("upload complete", {
    ...trace,
    files: body.assetIds.length,
    jobId: body.jobId,
  });
  return NextResponse.json(body);
}
