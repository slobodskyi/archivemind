import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintShareToken, shareTokenHash, shareTokenSchema } from "./share-token";

describe("share tokens", () => {
  it("mints a 43-character base64url token carrying 256 bits", async () => {
    const { token } = await mintShareToken();
    expect(shareTokenSchema.safeParse(token).success).toBe(true);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("never mints the same token twice", async () => {
    const tokens = await Promise.all(Array.from({ length: 50 }, () => mintShareToken()));
    expect(new Set(tokens.map((minted) => minted.token)).size).toBe(50);
  });

  it("hashes exactly as the node:crypto digest the existing publication rows were created with", async () => {
    const { token, tokenHash } = await mintShareToken();
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(await shareTokenHash(token)).toBe(tokenHash);
  });

  it("refuses to hash anything that is not a token", async () => {
    await expect(shareTokenHash("short")).rejects.toThrow();
    await expect(shareTokenHash(`${"A".repeat(42)}!`)).rejects.toThrow();
  });
});
