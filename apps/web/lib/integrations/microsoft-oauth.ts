import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Pure helpers for the Microsoft (OneDrive) OAuth exchange — ADR 0047.
 *  No network, no env, no path-alias imports, so vitest exercises them
 *  directly. Same discipline as google-oauth.ts. */

/** C4's minimum set, and no more. `Files.Read` is the LEAST-PRIVILEGED
 *  delegated permission for both `/children` and `/content` on personal AND
 *  work accounts (verified against the Graph reference, ADR 0047 S3) — the
 *  `.All` variants would broaden to everything shared with the user and make
 *  the consent screen worse for no capability we use.
 *
 *  `openid` is deliberately absent: the account's identity comes from
 *  `GET /me`, which `User.Read` already covers, so an id_token would be a
 *  scope we ask for and never read. */
export const MS_SCOPES = ["offline_access", "User.Read", "Files.Read"] as const;

export const MS_GRAPH = "https://graph.microsoft.com/v1.0";

/** The one scope whose absence makes the connection useless. Microsoft echoes
 *  granted scopes either bare (`Files.Read`) or resource-qualified
 *  (`https://graph.microsoft.com/Files.Read`), and the casing is not
 *  guaranteed, so compare on the last path segment, case-insensitively. */
export function hasFilesReadScope(scope: unknown): boolean {
  if (typeof scope !== "string") return false;
  return scope
    .split(/\s+/)
    .filter(Boolean)
    .some((s) => {
      const leaf = s.split("/").pop()?.toLowerCase();
      // ReadWrite implies Read; we never request it, but a tenant that
      // upgrades the grant must not read as "scope missing".
      return leaf === "files.read" || leaf === "files.readwrite";
    });
}

/** Token/authorize failure → first-party code (ADR 0021: Microsoft's own text
 *  never reaches a browser). `invalid_grant` on the code exchange means the
 *  one-time code is spent, expired, or was minted for another client — the
 *  user simply retries. */
export function mapTokenExchangeError(status: number, body: { error?: unknown }): string {
  if (status === 400 && body?.error === "invalid_grant") return "onedrive_code_invalid";
  if (status === 400 && body?.error === "invalid_client") return "onedrive_connect_failed";
  return "onedrive_connect_failed";
}

/** The `error` an authorize redirect can come back with. `access_denied` is
 *  the user clicking Cancel or an admin refusing consent — not a fault. */
export function mapAuthorizeError(error: string | null): string | null {
  if (!error) return null;
  if (error === "access_denied") return "onedrive_access_denied";
  return "onedrive_connect_failed";
}

// ── PKCE ────────────────────────────────────────────────────────────────────
// Required by C-level policy here even though a confidential client already
// authenticates with a secret: PKCE binds the redirect leg to the browser that
// started it, so a stolen `code` off the redirect URL is useless on its own.

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url"); // 43 chars, RFC 7636 range
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time state comparison. The value is a CSRF token, so a
 *  short-circuiting `===` leaks its prefix through timing. */
export function statesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── URL construction ────────────────────────────────────────────────────────

export function authorityBase(tenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
}

export function authorizeUrl(input: {
  tenant: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const q = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    // Force the account chooser: without it a user with a live Microsoft
    // session is silently reconnected as whoever they last were, which is the
    // "row says account Y but holds X's token" bug google-tokens.server.ts
    // grew an identity check for.
    prompt: "select_account",
  });
  return `${authorityBase(input.tenant)}/oauth2/v2.0/authorize?${q}`;
}

export function tokenUrl(tenant: string): string {
  return `${authorityBase(tenant)}/oauth2/v2.0/token`;
}

// ── Account shape ───────────────────────────────────────────────────────────

export type OneDriveAccountType = "personal" | "business";

/** `GET /me/drive` → driveType tells us which kind of account this is, and it
 *  is the discriminator we use rather than sniffing the tenant id: we call
 *  /me/drive anyway (we need the driveId), and `driveType` is the drive's own
 *  answer instead of our inference about it.
 *
 *  Why it matters at all, given ADR 0047 D4 keeps ONE code path: business and
 *  SharePoint return only `takenDateTime` from the photo facet, so this is what
 *  lets support explain sparse pre-fill without re-deriving it from a token. */
export function accountTypeFromDriveType(driveType: unknown): OneDriveAccountType {
  return driveType === "personal" ? "personal" : "business";
}

/** Best-effort display identity from `GET /me`. `mail` is often null on
 *  personal accounts, where userPrincipalName carries the address. */
export function emailFromMe(me: { mail?: unknown; userPrincipalName?: unknown }): string | null {
  if (typeof me.mail === "string" && me.mail) return me.mail;
  if (typeof me.userPrincipalName === "string" && me.userPrincipalName) {
    return me.userPrincipalName;
  }
  return null;
}
