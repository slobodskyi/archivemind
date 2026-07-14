import { NextResponse } from "next/server";
import { patchProjectRequestSchema, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** PATCH /api/projects/[id] — rename, archive/unarchive, or move to/restore
 *  from trash. RLS scopes the update (projects_update = is_editor). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid project id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = patchProjectRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const patch: Record<string, string | null> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.archived !== undefined) patch.archived_at = parsed.data.archived ? new Date().toISOString() : null;
  if (parsed.data.deleted !== undefined) patch.deleted_at = parsed.data.deleted ? new Date().toISOString() : null;

  const { data: row, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select("id, name, archived_at, deleted_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "project not found" }, { status: 404 });

  return NextResponse.json(row);
}
