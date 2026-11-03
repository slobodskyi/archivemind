import { listProjectShareAssets } from "@/lib/integrations/project-shares.server";
import { decodeShareCursor } from "@/lib/project-share-public";
import { shareJson, shareNotFound } from "@/lib/project-share-http";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /s/{token}/assets?cursor= — the next page of a download link's files
 *  (ADR 0051). Keyset-paged by (sort_at, id), 200 at a time; the cursor is
 *  opaque and comes from the previous page. */
export async function GET(request: Request, { params }: RouteContext) {
  const { token } = await params;
  const raw = new URL(request.url).searchParams.get("cursor");
  const cursor = raw === null || raw === "" ? null : decodeShareCursor(raw);
  if (raw && !cursor) return shareNotFound();

  try {
    const page = await listProjectShareAssets(token, cursor);
    return page ? shareJson(page) : shareNotFound();
  } catch (err) {
    console.error("project share assets:", err instanceof Error ? err.message : err);
    return shareNotFound();
  }
}
