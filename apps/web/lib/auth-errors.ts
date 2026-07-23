/** Turning a failed /auth/callback into one sentence the login card can show.
 *
 *  Two shapes of failure land here. Supabase can bounce the browser straight to
 *  the callback with `error` / `error_code` on the query string (consent denied,
 *  expired flow state, provider switched off), or the code exchange itself can
 *  fail and hand us an AuthError. Both reduce to a code.
 *
 *  The provider's `error_description` is deliberately not part of this contract.
 *  It is attacker-authored free text on a URL anyone can send a victim, and any
 *  sentence rendered from it would carry the app's voice on the app's own
 *  domain — a ready-made phishing line ("Your account is locked, call ..."). No
 *  shape filter fixes that, because ordinary prose is exactly the payload. Only
 *  copy we wrote ourselves is ever displayed.
 *
 *  Codes: https://supabase.com/docs/guides/auth/debugging/error-codes
 */

/** Query param we put on the /login redirect. Deliberately not Supabase's own
 *  `error` name: that arrives *at* the callback, this leaves it, and keeping
 *  them distinct makes the direction obvious at a glance. */
export const AUTH_ERROR_PARAM = "auth_error";

const GENERIC = "Sign-in failed. Please try again.";

/** Copy for the codes a user can actually hit. Anything not listed — including
 *  codes Supabase adds later — falls back to GENERIC.
 *
 *  Null-prototype: `code` comes straight off the query string, so a plain object
 *  literal would resolve inherited keys and `?auth_error=constructor` would hand
 *  the caller `Object` itself. */
const MESSAGES: Record<string, string> = Object.assign(Object.create(null), {
  // Expired or already-spent links — by far the common case.
  otp_expired: "That sign-in link has expired. Request a new one and try again.",
  flow_state_expired: "That sign-in link has expired. Request a new one and try again.",
  flow_state_not_found: "That sign-in link is no longer valid. Please sign in again.",
  // auth-js throws AuthPKCECodeVerifierMissingError when the verifier cookie is
  // gone; its code is pkce_code_verifier_not_found, not bad_code_verifier.
  pkce_code_verifier_not_found:
    "This sign-in link was opened in a different browser. Open it where you started, or sign in again.",
  bad_code_verifier:
    "This sign-in link was opened in a different browser. Open it where you started, or sign in again.",

  // User-side outcomes of the OAuth consent screen. `access_denied` and
  // `server_error` are OAuth2 `error` values Supabase forwards, not codes from
  // the doc link above — they reach us through the same param either way.
  access_denied: "Sign-in was cancelled.",
  user_banned: "This account has been suspended.",
  email_not_confirmed: "Confirm your email address first — check your inbox for the link.",
  provider_email_needs_verification:
    "Confirm your email address first — check your inbox for the link.",

  // Server-side misconfiguration: the user can't fix it, so don't imply they can.
  provider_disabled: "This sign-in method is currently unavailable.",
  signup_disabled: "New account creation is currently disabled.",

  // Reached /auth/update-password without a recovery session (link expired
  // mid-flow, or a direct hit) — send them back to request a fresh link.
  recovery_session_missing: "That password-reset link is invalid or has expired. Request a new one below.",
});

/**
 * Resolve the message to show. Returns null only when the param is absent — i.e.
 * no failed callback happened. An empty-string code still counts as a failure
 * (the callback sets the param unconditionally) and resolves to the generic
 * sentence, as does any code we have no copy for.
 */
export function authErrorMessage(code: string | null | undefined): string | null {
  if (code == null) return null;
  return MESSAGES[code] ?? GENERIC;
}
