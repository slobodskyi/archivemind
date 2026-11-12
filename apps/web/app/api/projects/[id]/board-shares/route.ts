import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@archivemind/shared";
import { projectShareRpcFailure, SHARE_NO_STORE } from "@/lib/project-shares-server";
import { createClient } from "@/lib/supabase/server";

const rowsSchema = z.array(z.object({ board_id: uuidSchema, live_count: z.number().int().nonnegative() }));

/** GET /api/projects/[id]/board-shares — how many live links reach each of a
 *  project's Workspaces, for the "reachable from outside" marker on a header
 *  chip (ADR 0053 §6), as the hub card already carries one for the project
 *  (ADR 0051 §12). Liveness is project_share_is_live()'s, so a Workspace in
 *  Trash counts nothing. Any member may ask — a viewer sees the same chips —
 *  and the answer carries counts only, never a link. */
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

  const { data, error } = await supabase.rpc("list_board_share_counts", { p_project_id: id });
  if (error) return projectShareRpcFailure(error);
  const rows = rowsSchema.safeParse(data ?? []);
  if (!rows.success) return NextResponse.json({ error: "share_unavailable" }, { status: 500 });
  const counts: Record<string, number> = {};
  for (const row of rows.data) if (row.live_count > 0) counts[row.board_id] = row.live_count;
  return NextResponse.json({ counts }, { headers: SHARE_NO_STORE });
}
