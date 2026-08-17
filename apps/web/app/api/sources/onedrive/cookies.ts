/** The short-lived cookies that carry OAuth state across the Microsoft
 *  redirect leg (ADR 0047). Shared by the start route and the callback so the
 *  names, flags and path can never drift apart — a mismatched `path` is the
 *  classic way a state cookie is set and then silently not sent back. */

/** Scoped to the OneDrive routes: these have no business riding along on every
 *  canvas request. The callback lives under this prefix, so it still gets them. */
export const MS_OAUTH_COOKIE_PATH = "/api/sources/onedrive";

const TEN_MINUTES = 600;

export type MsOAuthCookie = "state" | "verifier" | "next";

const NAMES: Record<MsOAuthCookie, string> = {
  state: "am_ms_state",
  verifier: "am_ms_verifier",
  next: "am_ms_next",
};

export function msOAuthCookieName(kind: MsOAuthCookie): string {
  return NAMES[kind];
}

export function msOAuthCookie(kind: MsOAuthCookie, value: string) {
  return {
    name: NAMES[kind],
    value,
    httpOnly: true,
    // Lax, deliberately: the return hop from login.microsoftonline.com is a
    // top-level GET navigation, which Lax allows and Strict does not.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: MS_OAUTH_COOKIE_PATH,
    maxAge: TEN_MINUTES,
  };
}

/** Same identity, zero lifetime — the callback clears all three whether it
 *  succeeded or failed, so a stale verifier can never be replayed. */
export function msOAuthCookieCleared(kind: MsOAuthCookie) {
  return { ...msOAuthCookie(kind, ""), maxAge: 0 };
}
