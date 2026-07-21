import { describe, expect, it } from "vitest";
import type { Photo } from "@/types";
import {
  assetGallery,
  droppedAssetCenters,
  fitBounds,
  hitTestTiles,
  mapCloudLayout,
  SAME_CLOUD_LINKS_PER_FILE,
  TAG_LINK_MEMBER_CAP,
  timelineAxisLayout,
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
    // (Cross-cloud is asserted via the id prefix, NOT strokeStart !== strokeEnd:
    // the 6-color hash palette can legitimately collide across clouds.)
    expect(cross[0].id).toBe("x-pl1-ua1");
    // The same-cloud webs still exist on both sides.
    expect(layout.edges.some((e) => e.id === "tag-ua1-ua2")).toBe(true);
    expect(layout.edges.some((e) => e.id === "tag-pl1-pl2")).toBe(true);
  });

  it("ignores ambient tags attached to more files than TAG_LINK_MEMBER_CAP", () => {
    const crowd = Array.from({ length: TAG_LINK_MEMBER_CAP + 1 }, (_, i) =>
      photo(`p${String(i).padStart(2, "0")}`, { tags: ["everything"] }),
    );
    expect(topicCloudLayout(crowd, {}).edges).toHaveLength(0);

    // At exactly the cap the tag still links.
    const atCap = topicCloudLayout(crowd.slice(0, TAG_LINK_MEMBER_CAP), {});
    expect(atCap.edges.length).toBeGreaterThan(0);
  });

  it("bounds same-cloud links at SAME_CLOUD_LINKS_PER_FILE per endpoint budget", () => {
    const n = 10;
    const crowd = Array.from({ length: n }, (_, i) =>
      photo(`p${String(i).padStart(2, "0")}`, { tags: ["shared"] }),
    );
    const layout = topicCloudLayout(crowd, {});
    // Complete graph would be C(10,2) = 45; the per-file budget keeps ≤ 4·n.
    expect(layout.edges.length).toBeLessThan((n * (n - 1)) / 2);
    expect(layout.edges.length).toBeLessThanOrEqual(SAME_CLOUD_LINKS_PER_FILE * n);
    // The weakest-ranked pair (between the two last ids) is one that gets dropped.
    expect(layout.edges.some((e) => e.id === "tag-p08-p09")).toBe(false);
  });

  it("never fabricates self-loops or double weight from duplicated tag names", () => {
    // The same tag NAME can be two DB rows (name+category unique key), so a
    // photo's tags array can legitimately contain duplicates.
    const solo = topicCloudLayout([photo("solo", { tags: ["kyiv", "kyiv"] })], {});
    expect(solo.edges).toHaveLength(0);

    const pair = topicCloudLayout(
      [photo("a", { tags: ["kyiv", "kyiv"] }), photo("b", { tags: ["kyiv"] })],
      {},
    );
    expect(pair.edges).toHaveLength(1);
    expect(pair.edges[0].op).toBeCloseTo(0.16); // one shared tag, not d1·d2 = 2
  });

  it("gives the Unsorted cloud real tag links too (lines mean relations now)", () => {
    const layout = mapCloudLayout(
      [
        photo("a", { country: "Atlantis", tags: ["myth"] }),
        photo("b", { country: "Lemuria", tags: ["myth"] }),
      ],
      {},
    );
    // Both unrecognized countries land in one Unsorted cloud; the shared tag
    // still links them — in the Unsorted gray (ADR 0022 supersedes 0018's
    // "no lines" rule; unanalyzed files are the ones with no lines).
    expect(layout.clouds.map((c) => c.key)).toEqual(["Unsorted"]);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].strokeStart).toBe("#8a8f98");
  });

  it("timeline is a chronological per-day axis: even columns, no lines, clamped drag", () => {
    const at = (d: string) => ({ ...photo("x").exif, dateTaken: d });
    const photos = [
      photo("jul1", { exif: at("2026-07-03 11:00") }),
      photo("apr1", { exif: at("2026-04-10 09:00") }),
      photo("apr2", { exif: at("2026-04-10 15:00") }),
    ];
    const layout = timelineAxisLayout(photos, {});

    // Day clouds in chronological order with DD/MM/YYYY labels and an axis.
    expect(layout.clouds.map((c) => c.key)).toEqual(["2026-04-10", "2026-07-03"]);
    expect(layout.clouds.map((c) => c.label)).toEqual(["10/04/2026", "03/07/2026"]);
    expect(layout.axis).toBeDefined();
    expect(layout.edges).toHaveLength(0); // the axis carries the structure, no tag web here
    // Evenly spaced columns: label x positions differ by the fixed gap.
    expect(layout.clouds[1].labelX - layout.clouds[0].labelX).toBe(420);
    // Same-day files stay inside their day's column; the odd file sits above the axis.
    expect(layout.tileCloud.apr1).toBe("2026-04-10");
    expect(layout.tileCloud.apr2).toBe("2026-04-10");
    expect(layout.tiles.apr1.cy).toBeLessThan(0); // above the axis (y=0)
    expect(layout.tiles.apr2.cy).toBeGreaterThan(0); // below
    // A single-file day centers exactly under its tick, above the axis (ceil).
    expect(layout.tiles.jul1.cx).toBe(layout.clouds[1].labelX);
    expect(layout.tiles.jul1.cy).toBeLessThan(0);
    // Partial rows re-center on the date: the two apr files straddle the tick.
    const aprX = layout.clouds[0].labelX;
    expect(layout.tiles.apr1.cx).toBe(aprX);
    expect(layout.tiles.apr2.cx).toBe(aprX);
    // Bounds cover the axis line and labels, not just the tile bbox.
    expect(layout.bounds.xl).toBeLessThanOrEqual(layout.axis!.x1);
    expect(layout.bounds.xr).toBeGreaterThanOrEqual(layout.axis!.x2);
    expect(layout.bounds.yb).toBeGreaterThanOrEqual(layout.axis!.y);

    // A drag override cannot pull a tile across its date border in EITHER
    // direction: the tile's EDGE clamps inside the column, y stays free.
    const w = layout.tiles.apr1.w;
    const right = timelineAxisLayout(photos, { apr1: { x: 5000, y: -300 } });
    expect(right.tiles.apr1.cx + w / 2).toBeLessThanOrEqual(aprX + 210);
    expect(right.tiles.apr1.cy).toBe(-300);
    const left = timelineAxisLayout(photos, { apr1: { x: -5000, y: 40 } });
    expect(left.tiles.apr1.cx - w / 2).toBeGreaterThanOrEqual(aprX - 210);
    expect(left.tiles.apr1.cy).toBe(40);
  });

  it("splits an odd day 2-above/1-below with each partial row centered on the tick", () => {
    const at = (d: string) => ({ ...photo("x").exif, dateTaken: d });
    const layout = timelineAxisLayout(
      [
        photo("a", { exif: at("2026-05-01 09:00") }),
        photo("b", { exif: at("2026-05-01 12:00") }),
        photo("c", { exif: at("2026-05-01 18:00") }),
      ],
      {},
    );
    const x = layout.clouds[0].labelX;
    // ceil(3/2) = 2 above (a, b — chronological), 1 below (c).
    expect(layout.tiles.a.cy).toBeLessThan(0);
    expect(layout.tiles.b.cy).toBeLessThan(0);
    expect(layout.tiles.c.cy).toBeGreaterThan(0);
    // Above row of 2 straddles the tick; the below single sits exactly on it.
    expect(layout.tiles.a.cx).toBe(x - 64);
    expect(layout.tiles.b.cx).toBe(x + 64);
    expect(layout.tiles.c.cx).toBe(x);
  });

  it("buckets malformed capture dates on the local 1970-01-01 epoch day", () => {
    const layout = timelineAxisLayout(
      [photo("bad", { exif: { ...photo("x").exif, dateTaken: "not a date" } })],
      {},
    );
    expect(layout.clouds.map((c) => c.key)).toEqual(["1970-01-01"]);
    expect(layout.clouds[0].label).toBe("01/01/1970");
  });

  it("timeline layout is deterministic for equivalent inputs", () => {
    const at = (d: string) => ({ ...photo("x").exif, dateTaken: d });
    const photos = [
      photo("a", { exif: at("2026-05-01 10:00") }),
      photo("b", { exif: at("2026-05-01 10:00") }),
      photo("c", { exif: at("2026-06-02 10:00") }),
    ];
    expect(timelineAxisLayout(photos, {})).toEqual(timelineAxisLayout([...photos].reverse(), {}));
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
