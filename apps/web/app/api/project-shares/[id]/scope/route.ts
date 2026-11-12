import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@archivemind/shared";
import { projectShareRpcFailure, SHARE_NO_STORE } from "@/lib/project-shares-server";
import { createClient } from "@/lib/supabase/server";

const rowsSchema = z.array(z.object({ asset_id: uuidSchema }));

/** GET /api/project-shares/[id]/scope — the files a link carries right now,
 *  for "Show on canvas" on ANY link (ADR 0053 §6). This is what the link
 *  SHOWS — the project, its Workspace or its fixed list, through the same
 *  project_share_scope_assets() the public page joins — as opposed to
 *  /received, which is what it brought IN. A turned-off link answers too, so
 *  an editor can still see what it used to reach. Editors only — the RPC
 *  checks and a viewer gets 403. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("list_project_share_scope", { p_share_id: id });
  if (error) return projectShareRpcFailure(error);
  const rows = rowsSchema.safeParse(data ?? []);
  if (!rows.success) return NextResponse.json({ error: "share_unavailable" }, { status: 500 });
  return NextResponse.json({ assetIds: rows.data.map((row) => row.asset_id) }, { headers: SHARE_NO_STORE });
}
