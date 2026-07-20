import { describe, expect, it } from "vitest";
import type { Photo } from "@/types";
import {
  assetGallery,
  droppedAssetCenters,
  fitBounds,
  hitTestTiles,
  mapCloudLayout,
  topicCloudLayout,
  type Bounds,
  type Frame,
  type TilePos,
} from "./layout";

type AssetInput = Parameters<typeof assetGallery>[0][number];

function asset(id: string, w = 400, h = 300): AssetInput {
  return { id, w, h };
}

/** Minimal real-shaped Photo for the cloud layouts (mirrors lib/assets.ts). */
function photo(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    seed: id,
    w: 400,
    h: 300,
    x: 0,
    y: 0,
    filename: `${id}.jpg`,
    processed: true,
    status: "Likely",
    captionKey: null,
    captionStyle: "Agency",
    chip: null,
    tags: null,
    facts: [],
    time: "07-15 12:00",
    day: "Jul 15",
    group: "archive",
    country: "Ukraine",
    source: "upload",
    folder: "Uploads",
    project: "",
    exif: {
      camera: "—",
      lens: "—",
      dateTaken: "2026-07-15 12:00",
      gpsLat: 0,
      gpsLon: 0,
      gpsLabel: "",
      iso: 0,
      aperture: "—",
      shutter: "—",
    },
    ...overrides,
  };
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

describe("cloud connecting lines (shared-AI-tag relations, ADR 0022)", () => {
  it("links two files iff they share at least one tag", () => {
    const layout = topicCloudLayout(
      [
        photo("a", { tags: ["rescue", "kyiv"] }),
        photo("b", { tags: ["kyiv"] }),
        photo("c", { tags: ["harbor"] }),
        photo("unanalyzed", { tags: null, processed: false }),
      ],
      {},
    );

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].id).toBe("tag-a-b");
    // Same-cloud link: solid cluster color, drawn between the pair's tile centers.
    expect(layout.edges[0].strokeStart).toBe(layout.edges[0].strokeEnd);
    expect(layout.edges[0].x1).toBe(layout.tiles.a.cx);
    expect(layout.edges[0].y2).toBe(layout.tiles.b.cy);
  });

  it("is not a complete graph: only tag-sharing pairs are linked", () => {
    const layout = topicCloudLayout(
      [
        photo("a", { tags: ["fire"] }),
        photo("b", { tags: ["fire"] }),
        photo("c", { tags: ["water"] }),
        photo("d", { tags: ["water"] }),
      ],
      {},
    );

    expect(layout.edges.map((e) => e.id).sort()).toEqual(["tag-a-b", "tag-c-d"]);
  });

  it("weights a same-cloud link by how many tags the pair shares (capped)", () => {
    const one = topicCloudLayout([photo("a", { tags: ["t1"] }), photo("b", { tags: ["t1"] })], {}).edges[0];
    const many = topicCloudLayout(
      [photo("a", { tags: ["t1", "t2", "t3"] }), photo("b", { tags: ["t1", "t2", "t3"] })],
      {},
    ).edges[0];
    const excess = topicCloudLayout(
      [
        photo("a", { tags: ["t1", "t2", "t3", "t4", "t5", "t6", "t7"] }),
        photo("b", { tags: ["t1", "t2", "t3", "t4", "t5", "t6", "t7"] }),
      ],
      {},
    ).edges[0];

    expect(one.op).toBeCloseTo(0.16);
    expect(many.op).toBeGreaterThan(one.op);
    expect(excess.op).toBeCloseTo(0.34); // cap
  });

  it("reduces cross-cloud links to one strongest bridge per pair of clouds", () => {
    const layout = mapCloudLayout(
      [
        photo("ua1", { country: "Ukraine", tags: ["evac", "train"] }),
        photo("ua2", { country: "Ukraine", tags: ["evac"] }),
        photo("pl1", { country: "Poland", tags: ["evac", "train"] }),
        photo("pl2", { country: "Poland", tags: ["evac"] }),
      ],
      {},
    );

    const cross = layout.edges.filter((e) => e.id.startsWith("x-"));
    expect(cross).toHaveLength(1);
    // Strongest pair: ua1↔pl1 share two tags, everything else shares one.
    expect(cross[0].id).toBe("x-pl1-ua1");
    expect(cross[0].strokeStart).not.toBe(cross[0].strokeEnd); // gradient between the clouds
    // The same-cloud webs still exist on both sides.
    expect(layout.edges.some((e) => e.id === "tag-ua1-ua2")).toBe(true);
    expect(layout.edges.some((e) => e.id === "tag-pl1-pl2")).toBe(true);
  });

  it("detaches a file dropped onto an artboard from the web", () => {
    const base = topicCloudLayout([photo("a", { tags: ["x"] }), photo("b", { tags: ["x"] })], {});
    const tile = base.tiles.a;
    const frame: Frame = { id: "f1", x: tile.cx - 10, y: tile.cy - 10, w: 20, h: 20, label: "Board" };

    const layout = topicCloudLayout([photo("a", { tags: ["x"] }), photo("b", { tags: ["x"] })], {}, [frame]);
    expect(layout.edges).toHaveLength(0);
  });

  it("is deterministic for equivalent inputs", () => {
    const photos = [
      photo("a", { tags: ["t1", "t2"] }),
      photo("b", { tags: ["t2"] }),
      photo("c", { tags: ["t1"], country: "Poland" }),
    ];
    expect(mapCloudLayout(photos, {})).toEqual(mapCloudLayout(photos.map((p) => ({ ...p })), {}));
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
