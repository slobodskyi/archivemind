import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { OneDriveTokenError, disconnect } from "@/lib/integrations/microsoft-tokens.server";

/** GET  /api/sources/onedrive — is this caller's Microsoft account connected?
 *  DELETE /api/sources/onedrive — forget the grant on our side (ADR 0047).
 *
 *  The GET reads through the CALLER's RLS client, not the admin one: every
 *  column it wants (status, email, provider_metadata) is member-readable by
 *  explicit grant, while the token ciphertexts are not — so the fence around
 *  lib/supabase/admin stays where ADR 0025 put it. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const { data, error } = await supabase
    .from("source_connections")
    .select("id, status, provider_account_email, provider_metadata")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("provider", "onedrive")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return NextResponse.json({ error: "onedrive_connect_failed" }, { status: 500 });

  const row = data?.[0];
  if (!row || row.status !== "active") {
    return NextResponse.json({ connected: false, email: null, accountType: null, connectionId: null });
  }
  const meta = (row.provider_metadata ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    connected: true,
    email: row.provider_account_email ?? null,
    accountType: meta.accountType === "personal" || meta.accountType === "business" ? meta.accountType : null,
    connectionId: row.id as string,
  });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  try {
    await disconnect({ workspaceId, userId: user.id });
    // `revokedUpstream: false` is not a detail — Microsoft exposes no
    // programmatic revocation, so the UI must tell the user to finish the job
    // in their Microsoft account rather than imply we already did.
    return NextResponse.json({ disconnected: true, revokedUpstream: false });
  } catch (err) {
    if (err instanceof OneDriveTokenError) {
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: "onedrive_disconnect_failed" }, { status: 502 });
  }
}
