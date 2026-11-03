import { decryptToken, encryptToken, parseTokenKey } from "@archivemind/shared/token-crypto";
import { shareTokenSchema } from "@/lib/share-token";

/** Project share links (ADR 0051) — token custody. A link is looked up by the
 *  SHA-256 of its token; the AES-GCM copy sealed here exists only so an editor
 *  can copy a live link again later. It uses the TOKEN_ENC_KEY Drive and
 *  OneDrive tokens already use, and nothing outside this module touches it. */

function shareTokenKey(): Buffer | null {
  try {
    return parseTokenKey(process.env.TOKEN_ENC_KEY);
  } catch {
    // A link made without a key still works; it just cannot be copied again.
    console.warn("project share: TOKEN_ENC_KEY unavailable, links will not be re-copyable");
    return null;
  }
}

/** The ciphertext to store beside a new link's digest, or null without a key. */
export function sealShareToken(token: string): string | null {
  const key = shareTokenKey();
  return key ? encryptToken(token, key) : null;
}

/** The token back from its ciphertext, or null when it cannot be read: no key,
 *  a rotated key, or a ciphertext that does not authenticate. */
export function openShareToken(ciphertext: string): string | null {
  const key = shareTokenKey();
  if (!key) return null;
  try {
    const token = decryptToken(ciphertext, key);
    return shareTokenSchema.safeParse(token).success ? token : null;
  } catch {
    return null;
  }
}
