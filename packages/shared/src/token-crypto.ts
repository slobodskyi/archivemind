import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for OAuth tokens at rest (ADR 0025). One implementation for both
 * writers and readers — the web connect route encrypts, the worker decrypts —
 * because two hand-maintained copies of a wire format is how tokens silently
 * become undecryptable mid-import.
 *
 * Wire format: `v1:<iv b64>:<ciphertext b64>:<tag b64>`. The version prefix
 * exists so TOKEN_ENC_KEY can be rotated deliberately (a v2 reader decrypts
 * both, re-encrypts on write) — not so old ciphertexts can be guessed at.
 *
 * Server-side only (node:crypto): exposed via the package's `./token-crypto`
 * subpath, NOT re-exported from the root index, so the browser-safe root
 * export stays browser-safe.
 */

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce size
const KEY_BYTES = 32;

/** Parse + validate the base64 TOKEN_ENC_KEY env value. Throws on missing or
 *  wrong-length keys — a truncated key must fail loudly at boot, not produce
 *  ciphertexts nothing can read. */
export function parseTokenKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("TOKEN_ENC_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), ct.toString("base64"), tag.toString("base64")].join(":");
}

export function decryptToken(encoded: string, key: Buffer): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`unrecognized token ciphertext format (expected ${VERSION}:iv:ct:tag)`);
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  // GCM authenticates on final(): tampered ct/tag or a wrong key throws here.
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
