import { describe, expect, it } from "vitest";
import { buildClusterIndex, coverCells, MAX_ZOOM } from "./geo-cluster";
import type { GeoPoint } from "./geo";

/** Newest-first, the order `geoPointsFromPhotos` hands the map. */
const at = (idx: number, lng: number, lat: number): GeoPoint => ({
  assetId: `a${idx}`,
  lng,
  lat,
  thumb: `https://example.test/${idx}.webp`,
  filename: `${idx}.jpg`,
  label: null,
});

/** Five photos within metres of each other — one cluster at any sane zoom. */
const oneSpot: GeoPoint[] = [0, 1, 2, 3, 4].map((i) => at(i, 30.5234 + i * 0.00001, 50.4501));

const clustersOf = (points: GeoPoint[], zoom: number) =>
  buildClusterIndex(points).getClusters([-180, -85, 180, 85], zoom);

describe("buildClusterIndex", () => {
  it("gives every cluster its cover photos", () => {
    // The regression this guards: supercluster ignores `map` unless `reduce` is
    // supplied too, so the covers silently never arrived and every cluster
    // marker painted an empty plate.
    const [feature, ...rest] = clustersOf(oneSpot, 4);
    expect(rest).toHaveLength(0);
    const props = feature.properties;
    expect("cluster" in props && props.point_count).toBe(5);
    expect("cluster" in props && props.cover).toEqual([0, 1, 2, 3]);
  });

  it("carries the NEWEST photos up, not whichever leaf the tree reached first", () => {
    // Reversing the coordinates leaves the same spatial set with the newest
    // photo at the other end of it; the mosaic must still be 0, 1, 2, 3.
    const reversed = oneSpot.map((p, i) => ({ ...p, lng: oneSpot[oneSpot.length - 1 - i].lng }));
    const props = clustersOf(reversed, 4)[0].properties;
    expect("cluster" in props && props.cover).toEqual([0, 1, 2, 3]);
  });

  it("resolves to individual points once the zoom can split them", () => {
    const spread = [at(0, 30.5, 50.4), at(1, -74.0, 40.7)];
    const features = clustersOf(spread, MAX_ZOOM);
    expect(features).toHaveLength(2);
    expect(features.every((f) => !("cluster" in f.properties))).toBe(true);
  });
});

describe("coverCells", () => {
  it("reads the cover indices back as cells, newest first", () => {
    expect(coverCells([2, 0], oneSpot)).toEqual([
      { thumb: oneSpot[2].thumb, label: null },
      { thumb: oneSpot[0].thumb, label: null },
    ]);
  });

  it("carries each photo's own colour label, not the cluster's", () => {
    const mixed = [
      { ...at(0, 30.5, 50.4), label: "red" as const },
      { ...at(1, 30.5, 50.4), label: null },
      { ...at(2, 30.5, 50.4), label: "blue" as const },
    ];
    expect(coverCells([0, 1, 2], mixed).map((c) => c.label)).toEqual(["red", null, "blue"]);
  });

  it("leaves a pending preview undefined rather than guessing", () => {
    const points = [{ ...at(0, 30.5, 50.4), thumb: undefined }];
    expect(coverCells([0], points)).toEqual([{ thumb: undefined, label: null }]);
  });

  it("keeps an empty cell for an index with no point — the grid is sized by the cluster", () => {
    expect(coverCells([0, 99], oneSpot)).toHaveLength(2);
    expect(coverCells([0, 99], oneSpot)[1]).toEqual({ thumb: undefined, label: null });
  });
});
