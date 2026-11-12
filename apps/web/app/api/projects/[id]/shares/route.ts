import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@archivemind/shared";
import { sealShareToken } from "@/lib/integrations/project-shares.server";
import { createProjectShareRequestSchema, projectSharePath, projectShareRights } from "@/lib/project-shares";
import { projectShareRpcFailure, readProjectShares, SHARE_NO_STORE } from "@/lib/project-shares-server";
import { mintShareToken } from "@/lib/share-token";
import { createClient } from "@/lib/supabase/server";

/** GET /api/projects/[id]/shares — every unrevoked link of the project, for
 *  the Share dialog. Editors only (the RPC checks); viewers get 403. */
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

  const result = await readProjectShares(supabase, id);
  if (result.error) return projectShareRpcFailure(result.error);
  return NextResponse.json({ shares: result.shares }, { headers: SHARE_NO_STORE });
}

/** POST /api/projects/[id]/shares — make a link (ADR 0051) of any scope
 *  (ADR 0053): the project, one of its Workspaces, or a list of its files. The token is
 *  minted here and leaves only inside this response's `path`; the database
 *  receives its SHA-256 and an AES-GCM copy. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = createProjectShareRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { token, tokenHash } = await mintShareToken();
  const rights = projectShareRights(parsed.data.mode);
  const { data, error } = await supabase
    .rpc("create_project_share", {
      p_project_id: id,
      p_can_download: rights.canDownload,
      p_can_upload: rights.canUpload,
      p_expires_in_days: parsed.data.expiresInDays,
      p_label: parsed.data.label ?? null,
      p_token_hash: tokenHash,
      p_token_ciphertext: sealShareToken(token),
      // ADR 0053. Ids not live in the project are dropped by the RPC, never
      // stored; a list that drops to nothing is refused there.
      p_scope: parsed.data.scope,
      p_board_id: parsed.data.boardId ?? null,
      p_asset_ids: parsed.data.assetIds ?? null,
    })
    .single();
  if (error) return projectShareRpcFailure(error);
  const created = z.object({ id: uuidSchema }).safeParse(data);
  if (!created.success) return NextResponse.json({ error: "share_unavailable" }, { status: 500 });

  const listed = await readProjectShares(supabase, id);
  const share = listed.shares?.find((candidate) => candidate.id === created.data.id);
  if (!share) return NextResponse.json({ error: "share_unavailable" }, { status: 500 });

  // The raw token is the source of truth for the path, whether or not this
  // server could also decrypt the stored copy.
  return NextResponse.json({ share: { ...share, path: projectSharePath(token) } }, {
    status: 201,
    headers: SHARE_NO_STORE,
  });
}
