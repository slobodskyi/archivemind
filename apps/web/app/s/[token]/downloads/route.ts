import { z } from "zod";
import { artboardSettingsSchema, EXPORT_MAX_ASSETS, exportJobPayloadSchema } from "@archivemind/shared";
import {
  enqueueProjectShareDownload,
  openProjectShare,
} from "@/lib/integrations/project-shares.server";
import { shareJson, shareNotFound } from "@/lib/project-share-http";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 500 uuids in JSON is ~20 KB; anything far past that is not a request this
 *  page makes. */
const MAX_BODY_BYTES = 64 * 1024;

const bodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(EXPORT_MAX_ASSETS),
});

/** POST /s/{token}/downloads — many files as one ZIP, through the ordinary
 *  export job (ADR 0051 §8). The client names only ids; the resolver keeps the
 *  ones live in this link's project, applies the per-link and per-workspace
 *  guards, stamps share_id and hands back an identical finished archive rather
 *  than building it twice. Its refusals reach the client as four answers:
 *  not found, busy, limit, failed. */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return shareJson({ error: "failed" }, 413);
  let body: z.infer<typeof bodySchema>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return shareJson({ error: "failed" }, 413);
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return shareJson({ error: "failed" }, 400);
    body = parsed.data;
  } catch {
    return shareJson({ error: "failed" }, 400);
  }

  // The project's name titles the archive; opening also refuses an upload-only
  // or dead link before anything is queued.
  let result;
  try {
    const share = await openProjectShare(token);
    if (!share?.canDownload) return shareNotFound();
    const payload = exportJobPayloadSchema.parse({
      asset_ids: body.assetIds,
      title: share.projectName.slice(0, 120),
      options: artboardSettingsSchema.parse({ format: "zip", zipContents: "originals" }),
    });
    result = await enqueueProjectShareDownload(token, payload);
  } catch (err) {
    console.error("project share zip:", err instanceof Error ? err.message : err);
    return shareJson({ error: "failed" }, 503);
  }
  if (result.ok) return shareJson({ jobId: result.jobId }, 202);
  if (result.reason === "not_found") return shareNotFound();
  if (result.reason === "busy" || result.reason === "limit") {
    return shareJson({ error: result.reason }, 429);
  }
  return shareJson({ error: "failed" }, 503);
}
