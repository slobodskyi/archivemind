import { NextResponse } from "next/server";
import { trashActionRequestSchema, type TrashTarget } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { purgeTrashTargets } from "@/lib/trash-actions";

/** POST /api/trash/purge — "Delete permanently" for a MIXED selection (ADR 0049).
 *
 *  The only irreversible action in the app, so it is always confirmed in the UI
 *  first — and it is the first path by which a trashed PROJECT can be deleted
 *  at all: before this, the Trash offered a project nothing but Restore and a
 *  30-day wait.
 *
 *  Assets are the odd one out and stay that way: purging a photo means erasing
 *  R2 bytes and DB derivatives, so this ENQUEUES the worker's purge job (which
 *  re-checks status at run time, letting a racing restore win) instead of
 *  deleting rows. Projects, Workspaces and drafts hold no bytes of their own,
 *  so their rows go here and now. */
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

  const done: TrashTarget[] = await purgeTrashTargets(supabase, parsed.data.items, user.id);
  const doneKeys = new Set(done.map((t) => `${t.kind}:${t.id}`));
  const failed = parsed.data.items.filter((t) => !doneKeys.has(`${t.kind}:${t.id}`));

  return NextResponse.json({ done, failed });
}
