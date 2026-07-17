import { NextResponse } from "next/server";
import { patchCaptionRequestSchema, uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** PATCH /api/captions/[id] (spec §8.3/#14) — edit a caption's text (stamps
 *  is_edited=true so the worker never silently regenerates it), or clear the
 *  flag (resetEdited) as the confirmed-overwrite path before a regenerate.
 *  RLS scopes the update (captions_update = is_editor_of_asset). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid caption id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = patchCaptionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const patch =
    parsed.data.text !== undefined ? { text: parsed.data.text, is_edited: true } : { is_edited: false };

  const { data: row, error } = await supabase
    .from("captions")
    .update(patch)
    .eq("id", id)
    .select("id, lang, style, text, is_edited")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "caption not found" }, { status: 404 });

  return NextResponse.json(row);
}
