import { describe, expect, it } from "vitest";
import {
  assetGallery,
  droppedAssetCenters,
  fitBounds,
  hitTestTiles,
  type Bounds,
  type TilePos,
} from "./layout";

type AssetInput = Parameters<typeof assetGallery>[0][number];

function asset(id: string, w = 400, h = 300): AssetInput {
  return { id, w, h };
}

function intersects(a: TilePos, b: TilePos): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function allFinite(values: object): boolean {
  return Object.values(values).every((value) => typeof value === "number" && Number.isFinite(value));
}

describe("assetGallery", () => {
  it("is deterministic for equivalent inputs", () => {
    const photos = [asset("newest", 500, 280), asset("middle", 240, 360), asset("oldest")];
    const overrides = { middle: { x: 640.25, y: -120.5 } };

    expect(assetGallery(photos, overrides)).toEqual(assetGallery([...photos], { ...overrides }));
  });

  it("keeps existing defaults stable when a newest asset is prepended", () => {
    // getRealPhotos returns newest-first; the layout deliberately allocates in reverse.
    const existing = [asset("second"), asset("first")];
    const before = assetGallery(existing, {}).pos;
    const after = assetGallery([asset("third"), ...existing], {}).pos;

    expect(after.first).toEqual(before.first);
    expect(after.second).toEqual(before.second);
  });

  it("treats overrides as centers even when the preview aspect changes", () => {
    const center = { x: -123.5, y: 998.25 };
    const landscape = assetGallery([asset("photo", 600, 300)], { photo: center }).pos.photo;
    const portrait = assetGallery([asset("photo", 300, 600)], { photo: center }).pos.photo;

    for (const tile of [landscape, portrait]) {
      expect(tile.cx).toBe(center.x);
      expect(tile.cy).toBe(center.y);
      expect(tile.x + tile.w / 2).toBe(center.x);
      expect(tile.y + tile.h / 2).toBe(center.y);
    }
    expect(landscape.w).toBeGreaterThan(landscape.h);
    expect(portrait.h).toBeGreaterThan(portrait.w);
  });

  it("keeps every default tile non-overlapping across rows and aspect ratios", () => {
    const photos = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0
        ? asset(`landscape-${i}`, 800, 300)
        : i % 3 === 1
          ? asset(`portrait-${i}`, 300, 800)
          : asset(`square-${i}`, 500, 500),
    );
    const tiles = Object.values(assetGallery(photos, {}).pos);

    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        expect(intersects(tiles[i], tiles[j]), `tiles ${i} and ${j} overlap`).toBe(false);
      }
    }
  });

  it("derives bounds from actual tile extents, including far overrides", () => {
    const layout = assetGallery(
      [asset("right", 300, 600), asset("left", 600, 300)],
      { left: { x: -500, y: -300 }, right: { x: 1200, y: 900 } },
    );
    const tiles = Object.values(layout.pos);

    expect(layout.bounds).toEqual({
      xl: Math.min(...tiles.map((tile) => tile.x)),
      yt: Math.min(...tiles.map((tile) => tile.y)),
      xr: Math.max(...tiles.map((tile) => tile.x + tile.w)),
      yb: Math.max(...tiles.map((tile) => tile.y + tile.h)),
    });
  });

  it("returns finite fallback geometry for empty or invalid dimensions", () => {
    expect(assetGallery([], {}).bounds).toEqual({ xl: 0, yt: 0, xr: 1000, yb: 700 });

    const invalid = assetGallery(
      [asset("zero", 0, 0), asset("nan", Number.NaN, Number.POSITIVE_INFINITY), asset("negative", -1, -2)],
      {},
    );
    expect(allFinite(invalid.bounds)).toBe(true);
    for (const tile of Object.values(invalid.pos)) {
      expect(allFinite(tile)).toBe(true);
      expect(tile.w).toBeGreaterThan(0);
      expect(tile.h).toBeGreaterThan(0);
    }
  });

  it("keeps a 500-asset layout and its fitted transform finite", () => {
    const photos = Array.from({ length: 500 }, (_, i) =>
      asset(`asset-${i}`, 180 + (i % 7) * 40, 160 + (i % 5) * 50),
    );
    const layout = assetGallery(photos, {});
    const transform = fitBounds(layout.bounds, { width: 1440, height: 900 });

    expect(Object.keys(layout.pos)).toHaveLength(500);
    expect(allFinite(layout.bounds)).toBe(true);
    expect(allFinite(transform)).toBe(true);
    expect(transform.scale).toBeGreaterThan(0);
  });
});

describe("droppedAssetCenters", () => {
  it("places one asset exactly on the drop anchor and handles an empty batch", () => {
    const anchor = { x: 321.5, y: -44 };

    expect(droppedAssetCenters([], anchor)).toEqual({});
    expect(droppedAssetCenters(["one"], anchor)).toEqual({ one: anchor });
  });

  it("creates a deterministic, unique batch centered around the drop anchor", () => {
    const anchor = { x: 500, y: 700 };
    for (const ids of [["a", "b", "c"], ["a", "b", "c", "d"]]) {
      const first = droppedAssetCenters(ids, anchor);
      const second = droppedAssetCenters([...ids], { ...anchor });
      const points = Object.values(first);

      expect(second).toEqual(first);
      expect(new Set(points.map((point) => `${point.x}:${point.y}`))).toHaveLength(ids.length);
      expect(points.reduce((sum, point) => sum + point.x, 0) / points.length).toBe(anchor.x);
      expect((Math.min(...points.map((point) => point.y)) + Math.max(...points.map((point) => point.y))) / 2).toBe(anchor.y);
    }
  });
});

describe("hitTestTiles", () => {
  const tile = (x: number, y: number, w: number, h: number): TilePos => ({
    x,
    y,
    w,
    h,
    cx: x + w / 2,
    cy: y + h / 2,
  });

  it("includes partial intersections and excludes outside or edge-only contact", () => {
    const positions = {
      partial: tile(0, 0, 10, 10),
      contained: tile(6, 6, 5, 5),
      rightEdgeOnly: tile(20, 8, 4, 4),
      bottomEdgeOnly: tile(8, 20, 4, 4),
      outside: tile(-20, -20, 5, 5),
    };
    const marquee: Bounds = { xl: 5, yt: 5, xr: 20, yb: 20 };

    expect(hitTestTiles(positions, marquee)).toEqual(["partial", "contained"]);
  });

  it("returns no hits for an empty position map", () => {
    expect(hitTestTiles({}, { xl: 0, yt: 0, xr: 100, yb: 100 })).toEqual([]);
  });
});
