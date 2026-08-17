import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { safeNextUrl } from "@/lib/safe-redirect";
import { authorizeUrl, createPkcePair, createState } from "@/lib/integrations/microsoft-oauth";
import { msTenant } from "@/lib/integrations/microsoft-tokens.server";
import { msOAuthCookie } from "../cookies";

/** GET /api/sources/onedrive/oauth (ADR 0047) — start the connect flow.
 *
 *  A full-page redirect, not Google's popup+postMessage dance (ADR 0025). The
 *  reason is the app registration: Microsoft's confidential-client `Web`
 *  platform is what gives us a refresh token that outlives a day, and a `spa`
 *  redirect URI caps refresh tokens at 24 hours — fatal for a worker that
 *  re-reads bytes tomorrow. A Web redirect URI means a real redirect leg.
 *
 *  This route is NOT public: proxy.ts guards everything outside PUBLIC_PATHS,
 *  so both legs run with the caller's session, and the callback needs no
 *  anonymous entry point of its own. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const clientId = process.env.MS_CLIENT_ID;
  const redirectUri = process.env.MS_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    // Not configured for this deployment — a first-party code, same as the
    // dropbox_unavailable path, rather than a stack trace in the browser.
    const back = safeNextUrl(request.nextUrl.searchParams.get("next"), request.nextUrl);
    back.searchParams.set("onedrive_error", "onedrive_unavailable");
    return NextResponse.redirect(back);
  }

  const state = createState();
  const { verifier, challenge } = createPkcePair();

  const target = authorizeUrl({
    tenant: msTenant(),
    clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  const response = NextResponse.redirect(target);
  // httpOnly so the verifier is unreadable to script, and Lax so it survives
  // the top-level GET navigation back from login.microsoftonline.com (Strict
  // would drop it on exactly that hop and break every connect).
  response.cookies.set(msOAuthCookie("state", state));
  response.cookies.set(msOAuthCookie("verifier", verifier));
  // Where to land afterwards. Parked in a cookie rather than round-tripped
  // through Microsoft's `state`, so the value never leaves our own origin.
  response.cookies.set(
    msOAuthCookie("next", safeNextUrl(request.nextUrl.searchParams.get("next"), request.nextUrl).pathname),
  );
  return response;
}
