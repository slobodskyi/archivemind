import { NextResponse } from "next/server";
import { uuidSchema } from "@archivemind/shared";
import { updateProjectShareRequestSchema } from "@/lib/project-shares";
import { projectShareRpcFailure, SHARE_NO_STORE } from "@/lib/project-shares-server";
import { createClient } from "@/lib/supabase/server";

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

/** PATCH /api/project-shares/[id] — extend (a new deadline counted from now,
 *  same URL; the link's creator or a workspace owner only) and/or relabel. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = updateProjectShareRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  if (parsed.data.expiresInDays !== undefined) {
    const { error } = await supabase.rpc("extend_project_share", {
      p_share_id: id,
      p_expires_in_days: parsed.data.expiresInDays,
    });
    if (error) return projectShareRpcFailure(error);
  }
  if (parsed.data.label !== undefined) {
    const { error } = await supabase.rpc("rename_project_share", {
      p_share_id: id,
      p_label: parsed.data.label,
    });
    if (error) return projectShareRpcFailure(error);
  }
  return NextResponse.json({ updated: true }, { headers: SHARE_NO_STORE });
}

/** DELETE /api/project-shares/[id] — turn the link off. Terminal: anyone
 *  holding it loses access with their next request. Any editor may do it. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.rpc("revoke_project_share", { p_share_id: id });
  if (error) return projectShareRpcFailure(error);
  return NextResponse.json({ revoked: true }, { headers: SHARE_NO_STORE });
}
