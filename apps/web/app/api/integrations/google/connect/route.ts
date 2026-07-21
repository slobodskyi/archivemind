import { NextResponse } from "next/server";
import { googleConnectRequestSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { DriveTokenError, exchangeCodeAndStore } from "@/lib/integrations/google-tokens.server";

/** POST /api/integrations/google/connect (ADR 0025) — server half of the
 *  popup code flow: the browser hands over the one-time authorization code,
 *  we exchange + encrypt + store. Authed like every /api route (proxy.ts);
 *  no public callback exists.
 *
 *  Error contract (ADR 0021): the body is `{ error: <first-party code> }` —
 *  Google's token-endpoint JSON never crosses this boundary. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = googleConnectRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  try {
    const { email, connectionId } = await exchangeCodeAndStore({
      code: parsed.data.code,
      workspaceId,
      userId: user.id,
    });
    return NextResponse.json({ connected: true, email, connectionId });
  } catch (err) {
    if (err instanceof DriveTokenError) {
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    console.error("google connect failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "drive_connect_failed" }, { status: 502 });
  }
}
