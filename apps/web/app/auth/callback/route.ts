import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ERROR_PARAM } from "@/lib/auth-errors";
import { safeNextUrl } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/** PKCE code exchange — target of email-confirmation links and of the Google
 *  OAuth redirect (#89). Nothing we send sets `next`, so any value is
 *  caller-supplied by definition and goes through safeNextUrl(). Every failure
 *  path carries a reason code to /login rather than dropping the user on a card
 *  with nothing to act on.
 *
 *  `nextUrl` is the parsed convenience URL; it resolves to the same host as
 *  `request.url` (NextRequest builds one from the other), so it is used here
 *  for `.clone()` and normalized paths — not for any proxy-host guarantee. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(safeNextUrl(url.searchParams.get("next"), url.toString()));
    }
    return failed(url, error.code ?? null);
  }

  // No code: either the provider rejected the flow before issuing one and said
  // why on the query string, or the URL was hit with nothing useful at all.
  // `error_code` is the specific one (otp_expired); `error` is the OAuth-level
  // bucket (access_denied) and only stands in when the specific one is absent.
  return failed(url, url.searchParams.get("error_code") ?? url.searchParams.get("error"));
}

/** Send the reason to /login as a code only. The provider's own
 *  `error_description` is deliberately NOT forwarded: it is attacker-authored
 *  free text, and whatever we rendered from it would speak in the app's voice
 *  on the app's domain. /login maps the code to our own copy. */
function failed(url: NextRequest["nextUrl"], code: string | null) {
  const failure = url.clone();
  failure.pathname = "/login";
  failure.hash = "";
  // Wholesale replacement, not a mutation of the inherited query — otherwise
  // the PKCE `code` rides along into the /login URL and its Referer.
  failure.search = "";
  // Always set the param, even empty: its presence is what tells /login a real
  // callback failed, so a bare hit on this route still surfaces something.
  failure.searchParams.set(AUTH_ERROR_PARAM, code ?? "");
  return NextResponse.redirect(failure);
}
