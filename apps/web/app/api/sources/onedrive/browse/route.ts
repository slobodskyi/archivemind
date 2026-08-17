import { NextResponse, type NextRequest } from "next/server";
import { oneDriveIdSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { MS_GRAPH } from "@/lib/integrations/microsoft-oauth";
import { OneDriveTokenError, getGraphSession } from "@/lib/integrations/microsoft-tokens.server";
import {
  ONEDRIVE_CHILD_SELECT,
  isSafeSkipToken,
  skipTokenFromNextLink,
  sortBrowseEntries,
  toBrowseEntry,
  type GraphDriveItem,
} from "@/lib/onedrive";

/** GET /api/sources/onedrive/browse — one folder's children (ADR 0047 D1).
 *
 *  Server-side on purpose: the Graph access token never reaches the browser.
 *  That is the security difference between this and an embedded picker, and it
 *  is why the whole SharePoint-resource-token problem (S2) does not exist for
 *  us — there is exactly one token, and it stays here.
 *
 *  Query: ?itemId=<id|root>&driveId=<id>&skipToken=<opaque>
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const rawItemId = params.get("itemId");
  const rawDriveId = params.get("driveId");
  const rawSkip = params.get("skipToken");

  // Every id is interpolated into a Graph URL path, so validate before use —
  // the same zod schema the import contract applies, not a looser local rule.
  if (rawItemId && rawItemId !== "root" && !oneDriveIdSchema.safeParse(rawItemId).success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (rawDriveId && !oneDriveIdSchema.safeParse(rawDriveId).success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (rawSkip && !isSafeSkipToken(rawSkip)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  let session;
  try {
    session = await getGraphSession({ workspaceId, userId: user.id });
  } catch (err) {
    if (err instanceof OneDriveTokenError) {
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: "onedrive_browse_failed" }, { status: 502 });
  }

  const driveId = rawDriveId ?? session.driveId;
  const itemId = rawItemId && rawItemId !== "root" ? rawItemId : null;

  // Prefer the explicit drive when we know it; /me/drive is the fallback for a
  // connection stored before the driveId resolved.
  const base = driveId
    ? itemId
      ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children`
      : `/drives/${encodeURIComponent(driveId)}/root/children`
    : itemId
      ? `/me/drive/items/${encodeURIComponent(itemId)}/children`
      : "/me/drive/root/children";

  const query = new URLSearchParams({ $select: ONEDRIVE_CHILD_SELECT, $top: "200" });
  if (rawSkip) query.set("$skiptoken", rawSkip);

  const res = await fetch(`${MS_GRAPH}${base}?${query}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  }).catch(() => null);

  if (!res) return NextResponse.json({ error: "onedrive_browse_failed" }, { status: 502 });
  if (res.status === 401) {
    return NextResponse.json({ error: "onedrive_connection_revoked" }, { status: 409 });
  }
  if (res.status === 429 || res.status === 503) {
    // Honour Microsoft's own pacing rather than inventing one — and tell the
    // browser how long, so the UI can wait instead of hammering.
    const retryAfter = res.headers.get("retry-after") ?? "5";
    return NextResponse.json(
      { error: "onedrive_rate_limited", retryAfter: Number(retryAfter) || 5 },
      { status: 429, headers: { "retry-after": retryAfter } },
    );
  }
  if (!res.ok) {
    console.error(`onedrive browse: HTTP ${res.status}`);
    return NextResponse.json({ error: "onedrive_browse_failed" }, { status: 502 });
  }

  const body = (await res.json().catch(() => null)) as {
    value?: GraphDriveItem[];
    "@odata.nextLink"?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "onedrive_browse_failed" }, { status: 502 });

  const entries = sortBrowseEntries(
    (body.value ?? [])
      .map((raw) => toBrowseEntry(raw, driveId))
      .filter((e): e is NonNullable<typeof e> => e !== null),
  );

  return NextResponse.json(
    {
      driveId: driveId ?? entries[0]?.driveId ?? null,
      itemId: itemId ?? "root",
      items: entries,
      nextSkipToken: skipTokenFromNextLink(body["@odata.nextLink"]),
    },
    // A folder listing is per-user and changes upstream without our knowing.
    { headers: { "cache-control": "no-store" } },
  );
}
