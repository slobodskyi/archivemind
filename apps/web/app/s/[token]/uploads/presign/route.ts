import { reserveProjectShareUploads } from "@/lib/integrations/project-shares.server";
import { shareJson, shareNotFound } from "@/lib/project-share-http";
import {
  shareSenderName,
  shareUploadFilename,
  shareUploadKeyName,
  shareUploadMime,
  shareUploadPresignRequestSchema,
  type ShareUploadPresignRequest,
  type ShareUploadPresignResponse,
} from "@/lib/project-share-uploads";
import { presignPut } from "@/lib/r2";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 100 files × (512-char name + 255-char type) is ~80 KB of JSON at most. */
const MAX_BODY_BYTES = 128 * 1024;

/** POST /s/{token}/uploads/presign — room for up to 100 files (ADR 0051 §9).
 *  Every name is sanitised here, the reserve RPC locks the link and checks its
 *  quota, and the browser gets a 15-minute PUT to each reservation's STAGING
 *  key only — never to an original, which nobody outside this server writes.
 *  The PUT is signed with the declared length, so a bigger body fails at R2.
 *  Answers: the uploads, or not found / quota / invalid / failed. */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return shareJson({ error: "invalid" }, 413);
  let body: ShareUploadPresignRequest;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return shareJson({ error: "invalid" }, 413);
    const parsed = shareUploadPresignRequestSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return shareJson({ error: "invalid" }, 400);
    body = parsed.data;
  } catch {
    return shareJson({ error: "invalid" }, 400);
  }

  const items = body.files.map((file) => {
    const filename = shareUploadFilename(file.filename);
    return { filename, keyName: shareUploadKeyName(filename), mime: shareUploadMime(file.mime), bytes: file.size };
  });

  try {
    const reserved = await reserveProjectShareUploads(token, shareSenderName(body.senderName), items);
    if (!reserved.ok) {
      if (reserved.reason === "not_found") return shareNotFound();
      if (reserved.reason === "quota") return shareJson({ error: "quota" }, 413);
      if (reserved.reason === "invalid") return shareJson({ error: "invalid" }, 400);
      return shareJson({ error: "failed" }, 503);
    }
    // Reserve answers in request order, one row per item (checked by the
    // wrapper), so position pairs each file with its own reservation.
    const uploads = await Promise.all(
      reserved.slots.map(async (slot, index) => ({
        id: slot.id,
        uploadUrl: await presignPut(slot.stagingKey, items[index].mime, { contentLength: items[index].bytes }),
        contentType: items[index].mime,
      })),
    );
    const response: ShareUploadPresignResponse = { uploads };
    return shareJson(response);
  } catch (err) {
    // The reservations stay open and the sweep expires them: they cost the
    // link quota for two hours at most.
    console.error("project share presign:", err instanceof Error ? err.message : err);
    return shareJson({ error: "failed" }, 503);
  }
}
