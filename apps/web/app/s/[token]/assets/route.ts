import { assetLabelSchema } from "@archivemind/shared";
import { listProjectShareAssets } from "@/lib/integrations/project-shares.server";
import {
  decodeShareCursor,
  SHARE_TAG_FILTER_MAX,
  type ProjectShareFilter,
} from "@/lib/project-share-public";
import { shareJson, shareNotFound } from "@/lib/project-share-http";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The recipient's filters (ADR 0053 §4), or null for a malformed one. An
 *  absent or empty parameter is no filter. Shape only: whether the link shows
 *  that detail at all is the resolver's question, and a "no" there is the
 *  same 404 as a malformed value here. */
function readFilter(params: URLSearchParams): ProjectShareFilter | null {
  const filter: ProjectShareFilter = {};
  const board = params.get("board");
  if (board) {
    if (!UUID.test(board)) return null;
    filter.board = board.toLowerCase();
  }
  const label = params.get("label");
  if (label) {
    const parsed = assetLabelSchema.safeParse(label);
    if (!parsed.success) return null;
    filter.label = parsed.data;
  }
  const tag = params.get("tag");
  if (tag) {
    if (tag.length > SHARE_TAG_FILTER_MAX || /[\u0000-\u001f\u007f]/.test(tag)) return null;
    filter.tag = tag;
  }
  return filter;
}

/** GET /s/{token}/assets?cursor=&board=&label=&tag= — a page of a download
 *  link's files (ADR 0051), optionally filtered by the details the link shows
 *  (ADR 0053). Keyset-paged by (sort_at, id), 200 at a time; the cursor is
 *  opaque and comes from the previous page under the same filter. */
export async function GET(request: Request, { params }: RouteContext) {
  const { token } = await params;
  const search = new URL(request.url).searchParams;
  const raw = search.get("cursor");
  const cursor = raw === null || raw === "" ? null : decodeShareCursor(raw);
  if (raw && !cursor) return shareNotFound();
  const filter = readFilter(search);
  if (!filter) return shareNotFound();

  try {
    // A filter on a detail the link does not show is refused in SQL and comes
    // back null here: the same 404 as a dead link, never its own error.
    const page = await listProjectShareAssets(token, cursor, filter);
    return page ? shareJson(page) : shareNotFound();
  } catch (err) {
    console.error("project share assets:", err instanceof Error ? err.message : err);
    return shareNotFound();
  }
}
