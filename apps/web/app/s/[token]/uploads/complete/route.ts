import {
  claimProjectShareUploads,
  completeProjectShareUploads,
  type ClaimedShareUpload,
  type ShareUploadCheck,
} from "@/lib/integrations/project-shares.server";
import { shareJson, shareNotFound } from "@/lib/project-share-http";
import {
  shareUploadCompleteRequestSchema,
  shareUploadOutcome,
  type ShareUploadCompleteRequest,
  type ShareUploadCompleteResponse,
} from "@/lib/project-share-uploads";
import { copyObject, deleteObject, headObject, isMissingObject } from "@/lib/r2";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A hundred server-side copies of up to 100 MiB each, eight at a time. */
export const maxDuration = 120;

const MAX_BODY_BYTES = 16 * 1024;
const COPY_CONCURRENCY = 8;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let index = next++; index < items.length; index = next++) out[index] = await fn(items[index]);
    }),
  );
  return out;
}

/** Copy one claimed reservation into its final key and measure THAT object —
 *  the staging key stays writable by its presigned PUT for 15 minutes, the
 *  final key never was. Null = R2 could not be asked: the row stays claimed,
 *  and the sender is told to send that file again. */
async function finalize(upload: ClaimedShareUpload): Promise<ShareUploadCheck | null> {
  try {
    await copyObject(upload.stagingKey, upload.finalKey);
  } catch (err) {
    // Nothing was ever PUT: there is nothing to keep.
    if (isMissingObject(err)) return { id: upload.id, ok: false, actualBytes: null };
    console.error("project share copy:", err instanceof Error ? err.message : err);
    return null;
  }
  try {
    const head = await headObject(upload.finalKey);
    if (!head) return { id: upload.id, ok: false, actualBytes: null };
    return { id: upload.id, ok: head.size === upload.declaredBytes, actualBytes: head.size };
  } catch (err) {
    console.error("project share head:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function quietDelete(key: string): Promise<void> {
  // Best effort: the worker sweep deletes whatever this misses.
  await deleteObject(key).catch(() => {});
}

/** POST /s/{token}/uploads/complete — finalize what the browser sent (ADR 0051
 *  §9): claim (one winner per reservation), copy staging → final, check the
 *  size on the final object, then one transaction makes the assets and ONE
 *  ingest job carrying share_id. A file whose size differs is rejected and
 *  both of its objects deleted. The staging copy goes last, once its asset
 *  exists. A retry after a lost response learns the outcome instead of
 *  repeating it. The sender learns "received" per file and a count — never an
 *  asset id, and never whether a file merged into a copy already there. */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return shareJson({ error: "invalid" }, 413);
  let body: ShareUploadCompleteRequest;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return shareJson({ error: "invalid" }, 413);
    const parsed = shareUploadCompleteRequestSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return shareJson({ error: "invalid" }, 400);
    body = parsed.data;
  } catch {
    return shareJson({ error: "invalid" }, 400);
  }

  try {
    const claimed = await claimProjectShareUploads(token, body.ids);
    if (!claimed) return shareJson({ error: "failed" }, 503);

    // Zero claimed is either a dead link or a retry of settled work; complete
    // answers both — statuses for the second, zero rows (404) for the first.
    const checks = (await mapLimit(claimed, COPY_CONCURRENCY, finalize)).filter(
      (check): check is ShareUploadCheck => check !== null,
    );
    const outcome = await completeProjectShareUploads(token, checks, body.ids);

    const byId = new Map(claimed.map((upload) => [upload.id, upload]));
    // Rejected bytes are deleted whatever complete answered: a check with
    // ok=false can never become an asset, and a later claim of the same row
    // then finds no staging object and rejects it again.
    await Promise.all(
      checks
        .filter((check) => !check.ok)
        .flatMap((check) => {
          const upload = byId.get(check.id);
          return upload ? [quietDelete(upload.finalKey), quietDelete(upload.stagingKey)] : [];
        }),
    );

    if (!outcome.ok) return outcome.reason === "not_found" ? shareNotFound() : shareJson({ error: "failed" }, 503);

    const completedHere = new Set(checks.filter((check) => check.ok).map((check) => check.id));
    await Promise.all(
      outcome.statuses.flatMap((row) => {
        const upload = byId.get(row.id);
        return upload && row.status === "completed" && completedHere.has(row.id) ? [quietDelete(upload.stagingKey)] : [];
      }),
    );

    const results = outcome.statuses.map((row) => ({ id: row.id, status: shareUploadOutcome(row.status) }));
    const response: ShareUploadCompleteResponse = {
      received: results.filter((row) => row.status === "received").length,
      results,
    };
    return shareJson(response);
  } catch (err) {
    console.error("project share complete:", err instanceof Error ? err.message : err);
    return shareJson({ error: "failed" }, 503);
  }
}
