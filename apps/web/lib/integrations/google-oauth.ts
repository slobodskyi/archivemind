/** Pure helpers for the Google OAuth exchange (ADR 0025) — no I/O, no env,
 *  no path-alias imports, so vitest can exercise them directly (the web app
 *  has no vitest alias config; keep these testable). */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Google's token-endpoint error → first-party code (ADR 0021: the body
 *  itself never leaves the server). invalid_grant = the one-time code is
 *  spent/expired/foreign — the user just retries. */
export function mapTokenExchangeError(status: number, body: { error?: unknown }): string {
  if (status === 400 && body?.error === "invalid_grant") return "drive_code_invalid";
  return "drive_connect_failed";
}

/** Best-effort email from the id_token GIS includes (openid scope rides
 *  along). No signature check needed: the JWT arrived directly from Google
 *  over the server-side TLS exchange, not from the browser. */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const segment = idToken.split(".")[1];
  if (!segment) return null;
  try {
    const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** Granular consent lets a user approve sign-in while unticking Drive access —
 *  the exchange still succeeds, just without the scope. */
export function hasDriveScope(scope: unknown): boolean {
  return typeof scope === "string" && scope.split(" ").includes(DRIVE_SCOPE);
}
