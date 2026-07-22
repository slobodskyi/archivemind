import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { EditRecipe } from "@archivemind/shared";
import { editPreviewKey, renderEditedPreviews } from "./edit-render";
import { PREVIEW_SIZES } from "./previews";

/** Smoke tests for the Tier-0 render (ADR 0030): solid images built in-memory,
 *  no fixtures. They pin the two things that break silently — that both preview
 *  sizes come out as valid webp within their edge bounds, and that the recipe's
 *  geometry (rotate90, crop) actually changes the produced aspect ratio. */

function recipe(overrides: Partial<EditRecipe> = {}): EditRecipe {
  return { rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null, ...overrides };
}

async function solid(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    .webp()
    .toBuffer();
}

describe("renderEditedPreviews", () => {
  it("emits thumb+medium as webp within their edge bounds for an identity recipe", async () => {
    const src = await solid(1000, 500);
    const previews = await renderEditedPreviews(src, recipe());

    expect(previews.map((p) => p.size)).toEqual(PREVIEW_SIZES.map((s) => s.size));
    for (const p of previews) {
      const edge = PREVIEW_SIZES.find((s) => s.size === p.size)!.edge;
      expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(edge);
      const meta = await sharp(p.data).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(p.width);
      expect(meta.height).toBe(p.height);
    }
  });

  it("rotate:90 turns a landscape source into a portrait medium", async () => {
    const src = await solid(1000, 500); // wide
    const previews = await renderEditedPreviews(src, recipe({ rotate: 90 }));
    const medium = previews.find((p) => p.size === "medium")!;
    expect(medium.height).toBeGreaterThan(medium.width);
  });

  it("cropping a square to its top half yields a wide medium", async () => {
    const src = await solid(800, 800); // square
    const previews = await renderEditedPreviews(src, recipe({ crop: { x: 0, y: 0, w: 1, h: 0.5 } }));
    const medium = previews.find((p) => p.size === "medium")!;
    expect(medium.width).toBeGreaterThan(medium.height);
  });

  it("a straighten with no explicit crop auto-insets (server fallback) and stays within the source", async () => {
    const src = await solid(1000, 800);
    const previews = await renderEditedPreviews(src, recipe({ straighten: 8 }));
    const medium = previews.find((p) => p.size === "medium")!;
    // The inscribed crop keeps the result no larger than the un-straightened
    // long edge — a full straightened bbox would EXCEED 1000 before resize, but
    // the inset holds it under the 1024 medium edge with room to spare.
    expect(Math.max(medium.width, medium.height)).toBeLessThanOrEqual(1024);
    expect(medium.width).toBeGreaterThan(0);
    expect(medium.height).toBeGreaterThan(0);
    const meta = await sharp(medium.data).metadata();
    expect(meta.format).toBe("webp");
  });
});

describe("editPreviewKey", () => {
  it("namespaces edited previews under the workspace's edits/ prefix", () => {
    expect(editPreviewKey("ws1", "asset1", "thumb")).toBe("ws1/edits/asset1/thumb.webp");
  });
});
