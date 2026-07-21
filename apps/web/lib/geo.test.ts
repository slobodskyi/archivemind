import { describe, expect, it } from "vitest";
import type { Photo } from "@/types";
import { boundsOf, formatCount, geoPointsFromPhotos, markerSize, missingLocationLabel } from "./geo";

const photo = (id: string, gpsLat: number | null, gpsLon: number | null): Photo =>
  ({
    id,
    seed: id,
    src: `https://example.test/${id}.webp`,
    w: 80,
    h: 60,
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
    time: "06-18 23:41",
    day: "Jun 18",
    group: "Unsorted",
    country: "Ukraine",
    source: "upload",
    folder: "Uploads",
    project: "",
    exif: {
      camera: "—",
      lens: "—",
      dateTaken: "2026-06-18 23:41",
      gpsLat,
      gpsLon,
      gpsLabel: "",
      iso: 0,
      aperture: "—",
      shutter: "—",
    },
  }) as Photo;

describe("geoPointsFromPhotos", () => {
  it("keeps photos with a real fix and preserves input order", () => {
    const points = geoPointsFromPhotos([
      photo("a", 50.45, 30.52),
      photo("b", 46.48, 30.72),
    ]);
    expect(points.map((p) => p.assetId)).toEqual(["a", "b"]);
    // GeoJSON order: longitude first. Swapping these silently relocates Kyiv
    // to the Indian Ocean instead of failing.
    expect(points[0]).toMatchObject({ lng: 30.52, lat: 50.45 });
  });

  it("drops photos with no fix, rather than plotting them at 0,0", () => {
    expect(geoPointsFromPhotos([photo("a", null, null)])).toHaveLength(0);
    expect(geoPointsFromPhotos([photo("a", 50.45, null)])).toHaveLength(0);
    expect(geoPointsFromPhotos([photo("a", null, 30.52)])).toHaveLength(0);
  });

  it("drops exactly 0,0 — a zeroed EXIF field, not the Gulf of Guinea", () => {
    expect(geoPointsFromPhotos([photo("a", 0, 0)])).toHaveLength(0);
    // A genuine near-zero coordinate is still plotted.
    expect(geoPointsFromPhotos([photo("a", 0.5, 0)])).toHaveLength(1);
    expect(geoPointsFromPhotos([photo("a", 0, 0.5)])).toHaveLength(1);
  });

  it("drops out-of-range and non-finite coordinates", () => {
    for (const [lat, lon] of [
      [91, 0],
      [-91, 0],
      [0, 181],
      [0, -181],
      [NaN, 0],
      [Infinity, 30],
    ]) {
      expect(geoPointsFromPhotos([photo("a", lat, lon)]), `${lat},${lon}`).toHaveLength(0);
    }
  });

  it("carries the thumb through so markers can render without a second fetch", () => {
    expect(geoPointsFromPhotos([photo("a", 50.45, 30.52)])[0].thumb).toBe("https://example.test/a.webp");
  });
});

describe("boundsOf", () => {
  it("returns null when there is nothing to frame", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("spans every point, west/south/east/north", () => {
    const bounds = boundsOf([
      { assetId: "a", lng: 30.5, lat: 50.4, filename: "a" },
      { assetId: "b", lng: 24.0, lat: 49.8, filename: "b" },
      { assetId: "c", lng: 36.2, lat: 50.0, filename: "c" },
    ]);
    expect(bounds).toEqual([24.0, 49.8, 36.2, 50.4]);
  });

  it("pads a zero-extent box so a single photo doesn't fit to maximum zoom", () => {
    const bounds = boundsOf([{ assetId: "a", lng: 30.5, lat: 50.4, filename: "a" }]);
    expect(bounds).not.toBeNull();
    const [w, s, e, n] = bounds as [number, number, number, number];
    expect(e - w).toBeGreaterThan(0);
    expect(n - s).toBeGreaterThan(0);
  });
});

describe("formatCount", () => {
  // Escapes rather than literal thin spaces: the two are indistinguishable on
  // screen, so a literal would let a regular space slip in unnoticed.
  it("groups thousands with a thin space, the way Apple Photos reads", () => {
    expect(formatCount(7)).toBe("7");
    expect(formatCount(42)).toBe("42");
    expect(formatCount(1234)).toBe("1 234");
    expect(formatCount(27027)).toBe("27 027");
    expect(formatCount(1234567)).toBe("1 234 567");
  });

  it("uses U+2009 THIN SPACE, not the regular space that would let it wrap", () => {
    expect(formatCount(1234)).toBe("1\u2009234");
    expect(formatCount(1234)).not.toContain(" ");
  });

  it("degrades safely on nonsense", () => {
    expect(formatCount(NaN)).toBe("0");
    expect(formatCount(-5)).toBe("0");
  });
});

describe("markerSize", () => {
  it("grows with the cluster but stays bounded", () => {
    expect(markerSize(1)).toBe(52);
    expect(markerSize(1)).toBeLessThan(markerSize(9));
    expect(markerSize(9)).toBeLessThan(markerSize(60));
    expect(markerSize(1_000_000)).toBe(markerSize(200));
  });
});

describe("missingLocationLabel", () => {
  it("says nothing when every file is on the map", () => {
    expect(missingLocationLabel(10, 10)).toBeNull();
    expect(missingLocationLabel(0, 0)).toBeNull();
  });

  it("counts what the map is not showing", () => {
    expect(missingLocationLabel(128, 125)).toBe("3 of 128 files have no location");
    expect(missingLocationLabel(2, 1)).toBe("1 of 2 files has no location");
  });
});
