import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptToken, parseTokenKey } from "@archivemind/shared/token-crypto";
import { mintShareToken } from "../share-token";
import { openShareToken, sealShareToken } from "./project-shares.server";

// vitest has no `@/` alias: the module under test reaches the real file.
vi.mock("@/lib/share-token", async () => import("../share-token"));

const key = randomBytes(32).toString("base64");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("project share token custody", () => {
  it("seals a token so only this key opens it", async () => {
    vi.stubEnv("TOKEN_ENC_KEY", key);
    const { token } = await mintShareToken();

    const sealed = sealShareToken(token) ?? "";

    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain(token);
    expect(openShareToken(sealed)).toBe(token);
  });

  it("stores and opens nothing without a key", async () => {
    vi.stubEnv("TOKEN_ENC_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { token } = await mintShareToken();

    expect(sealShareToken(token)).toBeNull();
    expect(openShareToken(encryptToken(token, parseTokenKey(key)))).toBeNull();
  });

  it("refuses a ciphertext sealed under another key", async () => {
    vi.stubEnv("TOKEN_ENC_KEY", key);
    const { token } = await mintShareToken();
    const sealed = sealShareToken(token) ?? "";

    vi.stubEnv("TOKEN_ENC_KEY", randomBytes(32).toString("base64"));

    expect(openShareToken(sealed)).toBeNull();
  });

  it("refuses a plaintext that is not a share token", () => {
    vi.stubEnv("TOKEN_ENC_KEY", key);

    expect(openShareToken(encryptToken("../../etc/passwd", parseTokenKey(key)))).toBeNull();
  });
});
