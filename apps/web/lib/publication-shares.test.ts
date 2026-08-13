import { describe, expect, it } from "vitest";
import { createArticleDraft, createInstagramCarouselDraft } from "./content-drafts";
import {
  createPublicationSnapshot,
  deletePublicationShareLink,
  listPublicationSharesResponseSchema,
  loadPublicationShareLink,
  publicationLinkExpired,
  publicationPreviewDimensions,
  publicationShareDisplayStatus,
  publicationShareRequiresRevoke,
  publicationShareTokenSchema,
  savePublicationShareLink,
  serializePublicationText,
} from "./publication-shares";

describe("publication shares", () => {
  it("sanitizes a private article into public asset references", () => {
    const draft = createArticleDraft({
      id: "draft-private",
      boardId: "board-private",
      sourceAssetIds: ["asset-private"],
      now: "2026-08-13T10:00:00.000Z",
      brief: { prompt: "private prompt", language: "uk" },
      content: {
        title: "A public story",
        sections: [{ id: "section-1", heading: "One", body: "Body", assetIds: ["asset-private"] }],
      },
    });

    const snapshot = createPublicationSnapshot(draft, new Map([["asset-private", "550e8400-e29b-41d4-a716-446655440000"]]));
    const json = JSON.stringify(snapshot);

    expect(snapshot.kind).toBe("article");
    expect(snapshot.language).toBe("uk");
    expect(json).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(json).not.toContain("asset-private");
    expect(json).not.toContain("board-private");
    expect(json).not.toContain("private prompt");
  });

  it("preserves text-only carousel slides", () => {
    const draft = createInstagramCarouselDraft({
      id: "draft",
      boardId: "board",
      sourceAssetIds: ["asset"],
      now: "2026-08-13T10:00:00.000Z",
      brief: { language: "ru" },
      content: {
        caption: "Post copy",
        slides: [{ id: "cover", assetId: null, headline: "Cover", body: "Hook" }],
      },
    });
    const snapshot = createPublicationSnapshot(draft, new Map());
    expect(snapshot.kind === "instagram_carousel" && snapshot.content.slides[0]?.publicAssetId).toBeNull();
    expect(snapshot.language).toBe("ru");
    expect(serializePublicationText(snapshot)).toContain("Post copy");
  });

  it("fails closed when a placed asset has no public id", () => {
    const draft = createArticleDraft({
      boardId: "board",
      sourceAssetIds: ["asset"],
      now: "2026-08-13T10:00:00.000Z",
      content: { sections: [{ id: "section", assetIds: ["asset"] }] },
    });
    expect(() => createPublicationSnapshot(draft, new Map())).toThrow("Missing public asset id");
  });

  it("accepts only 32-byte base64url bearer tokens", () => {
    expect(publicationShareTokenSchema.safeParse("A".repeat(43)).success).toBe(true);
    expect(publicationShareTokenSchema.safeParse("short").success).toBe(false);
    expect(publicationShareTokenSchema.safeParse(`${"A".repeat(42)}!`).success).toBe(false);
  });

  it("remembers and removes the last raw link in the draft's browser", () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
          removeItem: (key: string) => storage.delete(key),
        },
      },
    });
    const record = {
      schemaVersion: 1 as const,
      draftId: "draft-1",
      draftVersion: 4,
      result: {
        shareId: "550e8400-e29b-41d4-a716-446655440000",
        url: "https://archive.example/p/token",
        createdAt: "2026-08-13T10:00:00.000Z",
        expiresAt: null,
      },
    };

    expect(savePublicationShareLink(record)).toBe(true);
    expect(loadPublicationShareLink("draft-1")).toEqual(record);
    expect(deletePublicationShareLink("draft-1")).toBe(true);
    expect(loadPublicationShareLink("draft-1")).toBeNull();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("treats a passed deadline as expired and an absent or unreadable one as live", () => {
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    expect(publicationLinkExpired("2026-08-13T12:00:00.000Z", now)).toBe(true);
    expect(publicationLinkExpired("2026-08-14T12:00:00.000Z", now)).toBe(true);
    expect(publicationLinkExpired("2026-08-15T12:00:00.000Z", now)).toBe(false);
    expect(publicationLinkExpired(null, now)).toBe(false);
    // A corrupt local record must not hide a link that may still be serving.
    expect(publicationLinkExpired("not-a-date", now)).toBe(false);
  });

  it("keeps the manageable-link list free of anything that could address a link", () => {
    const parsed = listPublicationSharesResponseSchema.parse({
      shares: [{
        shareId: "550e8400-e29b-41d4-a716-446655440000",
        sourceDraftId: "draft-1",
        kind: "article",
        name: "Main story",
        status: "ready",
        allowDownloads: true,
        createdAt: "2026-08-13T10:00:00.000Z",
        expiresAt: "2026-09-12T10:00:00.000Z",
        // A resolver key or raw token must never survive this boundary, even if
        // a future RPC starts returning one.
        token: "secret",
        previewR2Key: "ws/shares/s/previews/p.webp",
      }],
    });
    expect(Object.keys(parsed.shares[0] ?? {}).sort()).toEqual([
      "allowDownloads", "createdAt", "expiresAt", "kind", "name", "shareId", "sourceDraftId", "status",
    ]);
  });

  it("derives author-facing states and treats preparing links as deletion blockers", () => {
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    expect(publicationShareDisplayStatus({ status: "ready", expiresAt: null }, now)).toBe("live");
    expect(publicationShareDisplayStatus({ status: "ready", expiresAt: "2026-08-14T11:00:00.000Z" }, now)).toBe("expired");
    expect(publicationShareDisplayStatus({ status: "revoked", expiresAt: null }, now)).toBe("revoked");
    expect(publicationShareRequiresRevoke({ status: "preparing", expiresAt: null }, now)).toBe(true);
    expect(publicationShareRequiresRevoke({ status: "ready", expiresAt: "2026-08-14T11:00:00.000Z" }, now)).toBe(false);
  });

  it("derives rotated and cropped edited-medium dimensions", () => {
    expect(publicationPreviewDimensions(1024, 768, {
      rotate: 90,
      flipH: false,
      flipV: false,
      straighten: 0,
      crop: null,
    })).toEqual({ width: 768, height: 1024 });

    expect(publicationPreviewDimensions(1024, 768, {
      rotate: 90,
      flipH: false,
      flipV: false,
      straighten: 0,
      crop: { x: 0, y: 0, w: 0.5, h: 1 },
    })).toEqual({ width: 384, height: 1024 });
  });
});
