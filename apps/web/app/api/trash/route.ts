import { NextResponse } from "next/server";
import {
  TRASH_FILTER_KEYS,
  trashResponseSchema,
  trashSortSchema,
  type TrashFilterKey,
} from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getTrashItems, TRASH_PAGE_SIZE } from "@/lib/trash";

/** GET /api/trash — the whole Trash, one list (ADR 0049).
 *
 *  Replaces `GET /api/assets?scope=trash`, which returned photos only, capped
 *  at 500 with no total, and left trashed Workspaces and drafts to two other
 *  places (one of them nowhere). Both surfaces read this: the homepage view
 *  unscoped, the in-canvas panel with `project` set.
 *
 *  Query: type (repeatable), project, q, sort, expiring, limit, offset. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;

  // Unknown chip keys are dropped rather than 400'd: a stale tab holding a
  // retired key should show everything, not an error page.
  const types = params
    .getAll("type")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value): value is TrashFilterKey =>
      (TRASH_FILTER_KEYS as readonly string[]).includes(value),
    );

  const sort = trashSortSchema.safeParse(params.get("sort") ?? "recent");
  const limit = Number.parseInt(params.get("limit") ?? "", 10);
  const offset = Number.parseInt(params.get("offset") ?? "", 10);
  const expiring = Number.parseInt(params.get("expiring") ?? "", 10);

  try {
    const trash = await getTrashItems(supabase, {
      types,
      projectId: params.get("project"),
      query: params.get("q") ?? undefined,
      sort: sort.success ? sort.data : "recent",
      expiringDays: Number.isFinite(expiring) ? expiring : null,
      // Clamped, not trusted: the page size is what bounds how many R2 objects
      // one request signs.
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : TRASH_PAGE_SIZE,
      offset: Number.isFinite(offset) ? Math.max(offset, 0) : 0,
    });
    return NextResponse.json(trashResponseSchema.parse(trash));
  } catch (err) {
    console.error("trash listing failed:", err);
    return NextResponse.json({ error: "trash listing failed" }, { status: 500 });
  }
}
