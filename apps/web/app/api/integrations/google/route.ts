import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { DriveTokenError, revokeConnection } from "@/lib/integrations/google-tokens.server";

/** GET /api/integrations/google — the caller's own gdrive connection status.
 *  Plain RLS client: member-select is allowed and the token columns are
 *  column-revoked, so this read physically cannot leak them. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  // A connection is personal (ADR 0025): filter by user_id, not just workspace.
  const { data, error } = await supabase
    .from("source_connections")
    .select("provider_account_email, status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("provider", "gdrive")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return NextResponse.json({ error: "drive_connect_failed" }, { status: 500 });

  const row = data?.[0];
  return NextResponse.json({
    connected: row?.status === "active",
    email: row?.provider_account_email ?? null,
  });
}

/** DELETE /api/integrations/google — revoke the Google grant and neuter the
 *  stored tokens. Errors are first-party codes only (ADR 0021/0025). */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  try {
    await revokeConnection({ workspaceId, userId: user.id });
    return NextResponse.json({ connected: false });
  } catch (err) {
    if (err instanceof DriveTokenError) {
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    console.error("google disconnect failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "drive_disconnect_failed" }, { status: 502 });
  }
}
