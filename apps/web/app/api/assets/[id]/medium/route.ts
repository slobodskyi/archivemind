import { NextResponse } from "next/server";
import { presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

/** GET /api/assets/[id]/medium — presigned URL for an asset's medium preview.
 *  The asset list presigns only thumbs (what the canvas renders); the drawer
 *  fetches the medium lazily on open. RLS scopes the row to the caller's
 *  workspace, so a foreign asset id simply returns url: null. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
