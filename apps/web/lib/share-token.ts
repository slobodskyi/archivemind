import { z } from "zod";

/** A share capability — a publication (ADR 0046) or a project link (ADR 0051):
 *  32 random bytes as a 43-character base64url path segment. Only the SHA-256
 *  of that string is stored, so a database read cannot be turned into working
 *  links. Both kinds of link use this one module, so they can never drift on
 *  what a token looks like or how it is hashed. WebCrypto only: this module is
 *  also imported by code that reaches the browser bundle. */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Hex SHA-256 of a well-formed token: the digest every resolver takes. */
export async function shareTokenHash(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(shareTokenSchema.parse(token));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A fresh token and its digest. The token goes into the URL and nowhere else
 *  in plaintext; the digest goes to the database. */
export async function mintShareToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { token, tokenHash: await shareTokenHash(token) };
}
