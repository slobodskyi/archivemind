import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@archivemind/shared";
import { projectShareRpcFailure, SHARE_NO_STORE } from "@/lib/project-shares-server";
import { createClient } from "@/lib/supabase/server";

const rowsSchema = z.array(z.object({ asset_id: uuidSchema }));

/** GET /api/project-shares/[id]/received — the files a link brought in that
 *  are still live in its project, for "Show on canvas" (ADR 0051 §12). A
 *  turned-off link answers too: switching it off does not undo what arrived.
 *  A file that merged into a copy the project already had is listed as that
 *  copy, because ingest moves the reservation onto the survivor. Editors
 *  only — the RPC checks and a viewer gets 403. */
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

  const { data, error } = await supabase.rpc("list_project_share_received", { p_share_id: id });
  if (error) return projectShareRpcFailure(error);
  const rows = rowsSchema.safeParse(data ?? []);
  if (!rows.success) return NextResponse.json({ error: "share_unavailable" }, { status: 500 });
  return NextResponse.json({ assetIds: rows.data.map((row) => row.asset_id) }, { headers: SHARE_NO_STORE });
}
