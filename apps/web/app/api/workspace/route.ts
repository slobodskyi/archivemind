import { NextResponse } from "next/server";
import { patchWorkspaceRequestSchema, type WorkspaceInfo } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** The caller's workspace + its credit/rights block (migration 20260727000001).
 *
 *  These four fields are the byline an exported deliverable carries. There is no
 *  settings page in the app, so the export dialog is where they are edited —
 *  which is also the only place they matter.
 *
 *  RLS is the gate on both verbs: `workspaces_select` is `is_member(id)` and
 *  `workspaces_update` is `is_owner(id)`, so a non-owner's PATCH simply affects
 *  zero rows. `canEdit` on the read exists so the client does not offer inputs
 *  whose save would silently no-op — it is UI state, not security. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  const { data: ws, error } = await supabase
    .from("workspaces")
    .select("id, name, creator, credit, copyright_notice, usage_terms")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ws) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  const body: WorkspaceInfo = {
    id: ws.id as string,
    name: (ws.name as string) ?? "",
    creator: (ws.creator as string | null) ?? null,
    credit: (ws.credit as string | null) ?? null,
    copyrightNotice: (ws.copyright_notice as string | null) ?? null,
    usageTerms: (ws.usage_terms as string | null) ?? null,
    canEdit: membership?.role === "owner",
  };
  return NextResponse.json(body);
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  const parsed = patchWorkspaceRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  // An empty string means "clear it" — a credit block half-filled with "" would
  // print an empty line on every page.
  const blank = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());
  const patch: Record<string, string | null> = {};
  if ("creator" in parsed.data) patch.creator = blank(parsed.data.creator);
  if ("credit" in parsed.data) patch.credit = blank(parsed.data.credit);
  if ("copyrightNotice" in parsed.data) patch.copyright_notice = blank(parsed.data.copyrightNotice);
  if ("usageTerms" in parsed.data) patch.usage_terms = blank(parsed.data.usageTerms);

  const { data: updated, error } = await supabase
    .from("workspaces")
    .update(patch)
    .eq("id", workspaceId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Zero rows = RLS refused it, i.e. the caller is not the owner.
  if (!updated) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  return NextResponse.json({ ok: true });
}
