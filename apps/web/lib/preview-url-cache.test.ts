import { describe, expect, it, vi } from "vitest";
import { createPreviewUrlCache, previewVersion } from "./preview-url-cache";

describe("createPreviewUrlCache", () => {
  it("asks once for concurrent requests and reuses the answer", async () => {
    const fetcher = vi.fn(async (id: string) => `https://r2/${id}/medium.webp?sig`);
    const cache = createPreviewUrlCache(fetcher);
    const [a, b] = await Promise.all([cache.get("x", "v1"), cache.get("x", "v1")]);
    expect(a).toBe(b);
    expect(await cache.get("x", "v1")).toBe(a);
    expect(cache.peek("x", "v1")).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("asks again once the answer is older than the TTL", async () => {
    let t = 0;
    const fetcher = vi.fn(async () => `u${t}`);
    const cache = createPreviewUrlCache(fetcher, () => t, 1000);
    await cache.get("x", "v1");
    t = 999;
    expect(cache.peek("x", "v1")).toBe("u0");
    t = 1000;
    expect(cache.peek("x", "v1")).toBeUndefined();
    expect(await cache.get("x", "v1")).toBe("u1000");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("treats a new version (an edit landed) as a different preview", async () => {
    const fetcher = vi.fn(async () => "u");
    const cache = createPreviewUrlCache(fetcher);
    await cache.get("x", "previews/x/thumb.webp");
    await cache.get("x", "edits/x/thumb.webp");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never caches a missing preview or a failed request", async () => {
    const fetcher = vi
      .fn<(id: string) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("u");
    const cache = createPreviewUrlCache(fetcher);
    expect(await cache.get("x", "v")).toBeNull();
    expect(await cache.get("x", "v")).toBeNull();
    expect(await cache.get("x", "v")).toBe("u");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("previewVersion", () => {
  it("drops the signature so the half-hourly re-sign is the same version", () => {
    expect(previewVersion("https://r2/ws/edits/a/thumb.webp?X-Amz-Signature=1")).toBe(
      "https://r2/ws/edits/a/thumb.webp",
    );
    expect(previewVersion(undefined)).toBe("");
  });
});
