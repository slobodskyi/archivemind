import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makePreviews, previewKey, previewSizesFor } from "./previews";

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } })
    .jpeg()
    .toBuffer();
}

describe("previewSizesFor (ADR 0055)", () => {
  it("gives every source thumb and medium, and large only above medium's edge", () => {
    expect(previewSizesFor(6000, 4000)).toEqual(["thumb", "medium", "large"]);
    expect(previewSizesFor(1025, 300)).toEqual(["thumb", "medium", "large"]);
    expect(previewSizesFor(1024, 768)).toEqual(["thumb", "medium"]);
    expect(previewSizesFor(300, 200)).toEqual(["thumb", "medium"]);
  });

  it("compares the long edge whichever way the photo is turned", () => {
    expect(previewSizesFor(2000, 3000)).toEqual(previewSizesFor(3000, 2000));
  });

  it("never claims a large for a source of unknown size", () => {
    expect(previewSizesFor(undefined, undefined)).toEqual(["thumb", "medium"]);
  });
});

describe("makePreviews", () => {
  it("writes a 2048 px large for a big original, each size within its edge", async () => {
    const out = await makePreviews({ kind: "encoded", data: await jpeg(3000, 2000) });
    expect(out.map((p) => [p.size, p.width, p.height])).toEqual([
      ["thumb", 256, 171],
      ["medium", 1024, 683],
      ["large", 2048, 1365],
    ]);
    expect((await sharp(out[2].data).metadata()).format).toBe("webp");
  });

  it("writes no large for an original medium already holds at full size", async () => {
    const out = await makePreviews({ kind: "encoded", data: await jpeg(1000, 800) });
    expect(out.map((p) => p.size)).toEqual(["thumb", "medium"]);
  });

  it("reads the size of a raw (HEIC-decoded) input from the input itself", async () => {
    const width = 1600;
    const height = 1200;
    const data = await sharp({ create: { width, height, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
      .raw()
      .toBuffer();
    const out = await makePreviews({ kind: "raw", data, width, height });
    expect(out.find((p) => p.size === "large")).toMatchObject({ width: 1600, height: 1200 });
  });

  it("makes only what `only` names — the backfill must not rewrite thumb or medium", async () => {
    const big = await makePreviews({ kind: "encoded", data: await jpeg(3000, 2000) }, ["large"]);
    expect(big.map((p) => p.size)).toEqual(["large"]);
    const small = await makePreviews({ kind: "encoded", data: await jpeg(900, 600) }, ["large"]);
    expect(small).toEqual([]);
  });
});

describe("previewKey", () => {
  it("keeps every size under the asset's previews/ prefix", () => {
    expect(previewKey("ws", "a", "large")).toBe("ws/previews/a/large.webp");
  });
});
