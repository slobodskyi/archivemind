import { NextResponse } from "next/server";
import { trashActionRequestSchema, type TrashTarget } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { trashTargets } from "@/lib/trash-actions";

/** POST /api/trash/delete — put a MIXED selection back into the Trash (ADR 0049).
 *
 *  The exact inverse of /api/trash/restore, and the reason it exists: restoring
 *  40 photos by mistake used to be undoable only by re-deleting them one at a
 *  time. A soft delete, like every other delete outside the Trash — nothing
 *  here erases anything. */
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

  const done: TrashTarget[] = await trashTargets(supabase, parsed.data.items);
  const doneKeys = new Set(done.map((t) => `${t.kind}:${t.id}`));
  const failed = parsed.data.items.filter((t) => !doneKeys.has(`${t.kind}:${t.id}`));

  return NextResponse.json({ done, failed });
}
