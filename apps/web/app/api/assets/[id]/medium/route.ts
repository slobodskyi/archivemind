import { NextResponse } from "next/server";
import { presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

/** GET /api/assets/[id]/medium — presigned URL for an asset's medium preview.
 *  The asset list presigns only thumbs (what the canvas renders); the drawer
 *  fetches the medium lazily on open. RLS scopes the row to the caller's
 *  workspace, so a foreign asset id simply returns url: null.
 *
 *  Defaults to the EDITED medium when a non-destructive edit exists (ADR 0030),
 *  so the drawer shows the edit. `?original=1` forces the untouched preview —
 *  the image editor renders from the original, since the recipe is defined
 *  relative to it and must not be applied on top of an already-edited image. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const wantOriginal = new URL(request.url).searchParams.get("original") === "1";

  if (!wantOriginal) {
    const { data: edit } = await supabase
      .from("asset_edits")
      .select("edited_medium_key")
      .eq("asset_id", id)
      .maybeSingle();
    if (edit?.edited_medium_key) {
      return NextResponse.json({ url: await presignGet(edit.edited_medium_key) });
    }
  }

  const { data, error } = await supabase
    .from("asset_previews")
    .select("r2_key")
    .eq("asset_id", id)
    .eq("size", "medium")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ url: null });

  return NextResponse.json({ url: await presignGet(data.r2_key) });
}
