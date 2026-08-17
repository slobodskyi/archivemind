import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { safeNextUrl } from "@/lib/safe-redirect";
import { mapAuthorizeError, statesMatch } from "@/lib/integrations/microsoft-oauth";
import {
  OneDriveTokenError,
  exchangeCodeAndStore,
} from "@/lib/integrations/microsoft-tokens.server";
import { msOAuthCookieCleared, msOAuthCookieName } from "../../cookies";

/** GET /api/sources/onedrive/oauth/callback (ADR 0047) — the redirect leg.
 *
 *  Error discipline is ADR 0021's, and this is the surface that ADR exists
 *  for: Microsoft sends `error` and `error_description` as query parameters on
 *  a URL pointing at OUR origin, so rendering `error_description` would print
 *  attacker-influenced text in our own voice. Only a first-party CODE ever
 *  leaves here; the description is dropped unread. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Where to land. Read before anything can fail, so even the error paths
  // return the user to the page they left rather than the app root.
  const nextPath = request.cookies.get(msOAuthCookieName("next"))?.value ?? "/";
  const destination = safeNextUrl(nextPath, request.nextUrl);

  const finish = (result: { ok: true } | { ok: false; code: string }) => {
    if (result.ok) destination.searchParams.set("onedrive", "connected");
    else destination.searchParams.set("onedrive_error", result.code);
    const res = NextResponse.redirect(destination);
    // Always burn all three, success or failure: a verifier that outlives its
    // exchange is a replayable credential.
    for (const kind of ["state", "verifier", "next"] as const) {
      res.cookies.set(msOAuthCookieCleared(kind));
    }
    return res;
  };

  const authorizeError = mapAuthorizeError(params.get("error"));
  if (authorizeError) return finish({ ok: false, code: authorizeError });

  // CSRF: the state we minted must come back, and it lives in an httpOnly
  // cookie the attacker's page cannot read or forge.
  const cookieState = request.cookies.get(msOAuthCookieName("state"))?.value;
  if (!statesMatch(cookieState, params.get("state") ?? undefined)) {
    return finish({ ok: false, code: "onedrive_state_invalid" });
  }

  const verifier = request.cookies.get(msOAuthCookieName("verifier"))?.value;
  const code = params.get("code");
  if (!verifier || !code) return finish({ ok: false, code: "onedrive_state_invalid" });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return finish({ ok: false, code: "onedrive_connect_failed" });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return finish({ ok: false, code: "onedrive_connect_failed" });

  try {
    await exchangeCodeAndStore({ code, codeVerifier: verifier, workspaceId, userId: user.id });
    return finish({ ok: true });
  } catch (err) {
    if (err instanceof OneDriveTokenError) return finish({ ok: false, code: err.code });
    console.error("onedrive connect failed:", err instanceof Error ? err.message : "unknown");
    return finish({ ok: false, code: "onedrive_connect_failed" });
  }
}
