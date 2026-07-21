import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, parseTokenKey } from "./token-crypto";

const KEY = randomBytes(32);

describe("parseTokenKey", () => {
  it("accepts a 32-byte base64 key", () => {
    const raw = randomBytes(32).toString("base64");
    expect(parseTokenKey(raw)).toHaveLength(32);
  });

  it("throws on missing key (fail loudly at boot, not at first decrypt)", () => {
    expect(() => parseTokenKey(undefined)).toThrow(/not set/);
    expect(() => parseTokenKey("")).toThrow(/not set/);
  });

  it("throws on wrong-length keys", () => {
    expect(() => parseTokenKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => parseTokenKey(randomBytes(33).toString("base64"))).toThrow(/32 bytes/);
    // valid base64 chars but truncated — the classic copy-paste accident
    expect(() => parseTokenKey("abc")).toThrow(/32 bytes/);
  });
});

describe("encryptToken / decryptToken", () => {
  it("round-trips arbitrary token strings", () => {
    for (const secret of ["1//0abc-refresh_token", "a", "об'єкт-utf8-☂", "x".repeat(4096)]) {
      expect(decryptToken(encryptToken(secret, KEY), KEY)).toBe(secret);
    }
  });

  it("produces the v1:iv:ct:tag wire format", () => {
    const parts = encryptToken("secret", KEY).split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[3], "base64")).toHaveLength(16);
  });

  it("uses a fresh IV per call (identical plaintexts must not repeat ciphertext)", () => {
    expect(encryptToken("same", KEY)).not.toBe(encryptToken("same", KEY));
  });

  it("throws on tampered ciphertext or tag (GCM auth)", () => {
    const enc = encryptToken("secret", KEY);
    const [v, iv, ct, tag] = enc.split(":");
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] ^= 0xff;
      return buf.toString("base64");
    };
    expect(() => decryptToken([v, iv, flip(ct), tag].join(":"), KEY)).toThrow();
    expect(() => decryptToken([v, iv, ct, flip(tag)].join(":"), KEY)).toThrow();
    expect(() => decryptToken([v, flip(iv), ct, tag].join(":"), KEY)).toThrow();
  });

  it("throws with the wrong key", () => {
    const enc = encryptToken("secret", KEY);
    expect(() => decryptToken(enc, randomBytes(32))).toThrow();
  });

  it("rejects unversioned or malformed input", () => {
    expect(() => decryptToken("", KEY)).toThrow(/format/);
    expect(() => decryptToken("v2:a:b:c", KEY)).toThrow(/format/);
    expect(() => decryptToken("v1:onlytwo", KEY)).toThrow(/format/);
    expect(() => decryptToken("plaintext-token-in-the-column", KEY)).toThrow(/format/);
  });
});
