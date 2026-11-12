import { NextResponse } from "next/server";
import { presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { originalMime, type OriginalAnswer } from "@/lib/viewer-originals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET /api/assets/[id]/original — the stored original, for the fullscreen
 *  viewer's last quality step (ADR 0054). Answers `{ url, mime, bytes }`, or
 *  `{ url: null, reason }` when there is nothing a browser could draw:
 *  `not_stored` (a Google Drive / OneDrive file — its original never enters
 *  R2) or `format` (RAW, TIFF, PDF…).
 *
 *  Reach is exactly the ZIP export's (ADR 0035): `files` under RLS
 *  (`files_select = is_member`), so a member who can already download an
 *  original as a file can now look at it. A foreign or unknown id reads as no
 *  rows and is the same 404 as a malformed one.
 *
 *  Three guards the RLS read alone would not give:
 *  - a trashed or purged asset answers 404 — a deleted photo is opened from
 *    the Trash, never through this viewer;
 *  - the key must sit under `{workspace_id}/originals/`, the one prefix
 *    uploads and Dropbox ingest write — the same check the share-link resolver
 *    makes, so no row can point this at a preview, an export or another
 *    workspace's object;
 *  - only formats on the displayable list are signed, so the route never hands
 *    out an inline URL for an SVG or anything else a browser would execute.
 *
 *  Signed INLINE (no filename → no attachment disposition) in the same
 *  30-minute signing bucket as the previews, so stepping back to a photo is a
 *  browser cache hit instead of another multi-megabyte download. The response
 *  carrying the URL is never cached. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (assetError) {
    console.error("[original] asset read failed", assetError.message);
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
  if (!asset || asset.status === "deleted") {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  // The durable copy first, oldest first — the order the ZIP export picks its
  // original in (export-zip.ts loadByteRows), so the two never disagree.
  const { data: files, error: filesError } = await supabase
    .from("files")
    .select("workspace_id, r2_key, mime_type, byte_size")
    .eq("asset_id", id)
    .not("r2_key", "is", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (filesError) {
    console.error("[original] files read failed", filesError.message);
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }

  const file = files?.[0] as
    | { workspace_id: string; r2_key: string | null; mime_type: string | null; byte_size: number | string | null }
    | undefined;
  const answer = (body: OriginalAnswer) => NextResponse.json(body, { headers: NO_STORE });
  if (!file?.r2_key || !file.r2_key.startsWith(`${file.workspace_id}/originals/`)) {
    return answer({ url: null, reason: "not_stored" });
  }
  const mime = originalMime(file.mime_type, file.r2_key);
  if (!mime) return answer({ url: null, reason: "format" });

  // bigint arrives as a string from PostgREST once it outgrows a JS number's
  // safe range; a photo never does, but parse rather than trust the type.
  const bytes = file.byte_size == null ? null : Number(file.byte_size);
  return answer({ url: await presignGet(file.r2_key), mime, bytes: Number.isFinite(bytes) ? bytes : null });
}
