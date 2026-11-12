import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { openShareToken } from "@/lib/integrations/project-shares.server";
import {
  projectSharePath,
  projectShareRowSchema,
  toProjectShareSummary,
  type ProjectShareSummary,
} from "@/lib/project-shares";

/** Server half of the editor-side project share routes (ADR 0051). */

export const SHARE_NO_STORE = { "Cache-Control": "private, no-store" } as const;

export interface ShareRpcError {
  code?: string;
  message?: string;
}

/** create_project_share()'s scope refusals (ADR 0053), each its own code so
 *  the dialog can say which part of the request no longer holds — usually a
 *  Workspace trashed or files moved out since the dialog opened. */
const SCOPE_REFUSALS: Record<string, string> = {
  project_share_revoked: "share_revoked",
  invalid_project_share_scope: "invalid_scope",
  invalid_project_share_board: "board_unavailable",
  invalid_project_share_selection: "invalid_selection",
  project_share_selection_empty: "selection_empty",
  invalid_project_share_rights: "invalid_rights",
  invalid_project_share_details: "invalid_details",
};

/** One mapping from the RPCs' stable error codes to HTTP. Tokens, digests and
 *  ciphertexts are deliberately absent from the log line. */
export function projectShareRpcFailure(error: ShareRpcError) {
  console.error("project share RPC failed", { code: error.code ?? "unknown" });
  if (error.code === "42501") {
    const owner = error.message === "project_share_owner_required";
    return NextResponse.json({ error: owner ? "owner_required" : "editor_required" }, { status: 403 });
  }
  if (error.code === "53400") return NextResponse.json({ error: "share_limit" }, { status: 409 });
  if (error.code === "22023") {
    return NextResponse.json({ error: SCOPE_REFUSALS[error.message ?? ""] ?? "invalid_share" }, { status: 400 });
  }
  return NextResponse.json({ error: "share_unavailable" }, { status: 500 });
}

type ReadResult =
  | { shares: ProjectShareSummary[]; error: null }
  | { shares: null; error: ShareRpcError };

/** Every unrevoked link of a project as an editor's browser may see it: status
 *  and counters, plus the path of each live link this server can decrypt. */
export async function readProjectShares(supabase: SupabaseClient, projectId: string): Promise<ReadResult> {
  const { data, error } = await supabase.rpc("list_project_shares", { p_project_id: projectId });
  if (error) return { shares: null, error };
  const rows = z.array(projectShareRowSchema).safeParse(data ?? []);
  if (!rows.success) return { shares: null, error: { code: "invalid_rows" } };
  return {
    shares: rows.data.map((row) => {
      const token = row.token_ciphertext ? openShareToken(row.token_ciphertext) : null;
      return toProjectShareSummary(row, token ? projectSharePath(token) : null);
    }),
    error: null,
  };
}
