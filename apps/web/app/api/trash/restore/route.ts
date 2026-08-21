import { NextResponse } from "next/server";
import { trashActionRequestSchema, type TrashTarget } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { restoreTrashTargets } from "@/lib/trash-actions";

/** POST /api/trash/restore — bring a MIXED selection back (ADR 0049).
 *
 *  A Trash selection can hold a project, two photos and a Workspace at once, so
 *  the body is (kind, id) pairs and the fan-out happens here: one request, one
 *  undo toast, one place where "restore" is defined per kind. The single-kind
 *  routes it delegates to stay where they are — the drawer's undo and the
 *  canvas's own restore still call `POST /api/assets/restore` directly.
 *
 *  RLS is the gate on every arm; an id the caller cannot see simply matches
 *  nothing and comes back in `failed`. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = trashActionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const done: TrashTarget[] = await restoreTrashTargets(supabase, parsed.data.items);
  const doneKeys = new Set(done.map((t) => `${t.kind}:${t.id}`));
  const failed = parsed.data.items.filter((t) => !doneKeys.has(`${t.kind}:${t.id}`));

  return NextResponse.json({ done, failed });
}
