import { describe, expect, it } from "vitest";
import { createArticleDraft, createInstagramCarouselDraft } from "./content-drafts";
import { contentDraftFilename, serializeContentDraft, usedAssetIds } from "./content-package";
import type { Photo } from "../types";

const ids = ["asset-1", "asset-2"];
const photos = [
  { id: ids[0], filename: "cover.jpg" },
  { id: ids[1], filename: "detail.jpg" },
] as Photo[];

describe("content packages", () => {
  it("serializes article copy with stable image filenames", () => {
    const draft = createArticleDraft({
      id: "draft-1",
      boardId: "board-1",
      name: "Launch / story",
      sourceAssetIds: ids,
      now: "2026-08-13T10:00:00.000Z",
      content: {
        title: "Launch story",
        intro: "Opening.",
        sections: [{ id: "section-1", heading: "Behind the scenes", body: "Body.", assetIds: ids }],
      },
    });

    expect(contentDraftFilename(draft)).toBe("Launch - story.md");
    expect(serializeContentDraft(draft, photos)).toContain("![cover.jpg](images/cover.jpg)");
    expect(usedAssetIds(draft)).toEqual(ids);
  });

  it("serializes an ordered carousel and deduplicates its photo manifest", () => {
    const draft = createInstagramCarouselDraft({
      id: "draft-2",
      boardId: "board-1",
      sourceAssetIds: ids,
      now: "2026-08-13T10:00:00.000Z",
      content: {
        caption: "Post caption",
        slides: [
          { id: "slide-1", assetId: ids[1], headline: "First", body: "One" },
          { id: "slide-2", assetId: ids[0], headline: "Second", body: "Two" },
          { id: "slide-3", assetId: ids[1], headline: "Again", body: "Three" },
        ],
        hashtags: ["#archive"],
      },
    });

    const text = serializeContentDraft(draft, photos);
    expect(text.indexOf("SLIDE 1 · detail.jpg")).toBeLessThan(text.indexOf("SLIDE 2 · cover.jpg"));
    expect(text).toContain("HASHTAGS\n#archive");
    expect(usedAssetIds(draft)).toEqual([ids[1], ids[0]]);
  });
});
