import { exportFilename } from "@archivemind/shared";
import { projectShareDownloadStatus } from "@/lib/integrations/project-shares.server";
import type { ProjectShareDownloadStatus } from "@/lib/project-share-public";
import {
  SHARE_PRESIGN_TTL_SECONDS,
  shareJson,
  shareNotFound,
  shareRedirect,
} from "@/lib/project-share-http";
import { presignGet } from "@/lib/r2";

interface RouteContext {
  params: Promise<{ token: string; jobId: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /s/{token}/downloads/{jobId} — a link ZIP's progress, or, once it is
 *  ready, a 302 to a 5-minute presign of the archive (ADR 0051 §8). Only a job
 *  this same link queued is visible; any other id is the uniform 404. The
 *  redirect is not cacheable: the same URL answers JSON until the job is done. */
export async function GET(_request: Request, { params }: RouteContext) {
  const { token, jobId } = await params;
  try {
    const job = await projectShareDownloadStatus(token, jobId);
    if (!job) return shareNotFound();

    if (job.status === "done" && job.resultKey) {
      const ext = job.resultKey.split(".").pop() ?? "zip";
      const url = await presignGet(
        job.resultKey,
        exportFilename(job.title, ext, new Date().toISOString()),
        { ttlSeconds: SHARE_PRESIGN_TTL_SECONDS },
      );
      return shareRedirect(url, null);
    }

    // Done with no key: the retention sweep has deleted the archive. Asking
    // again queues a fresh one, so this reads as a failure to retry.
    const body: ProjectShareDownloadStatus = job.status === "done"
      ? { status: "failed", progress: 0, error: "failed" }
      : { status: job.status, progress: job.progress, error: job.error };
    return shareJson(body);
  } catch (err) {
    console.error("project share download:", err instanceof Error ? err.message : err);
    return shareNotFound();
  }
}
