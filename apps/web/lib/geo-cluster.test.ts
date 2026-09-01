import { describe, expect, it } from "vitest";
import { buildClusterIndex, coverThumbs, MAX_ZOOM } from "./geo-cluster";
import type { GeoPoint } from "./geo";

/** Newest-first, the order `geoPointsFromPhotos` hands the map. */
const at = (idx: number, lng: number, lat: number): GeoPoint => ({
  assetId: `a${idx}`,
  lng,
  lat,
  thumb: `https://example.test/${idx}.webp`,
  filename: `${idx}.jpg`,
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
    expect("cluster" in props && props.cover).toEqual([0, 1, 2]);
  });

  it("carries the NEWEST photos up, not whichever leaf the tree reached first", () => {
    // Reversing the coordinates leaves the same spatial set with the newest
    // photo at the other end of it; the cover must still be index 0, 1, 2.
    const reversed = oneSpot.map((p, i) => ({ ...p, lng: oneSpot[oneSpot.length - 1 - i].lng }));
    const props = clustersOf(reversed, 4)[0].properties;
    expect("cluster" in props && props.cover).toEqual([0, 1, 2]);
  });

  it("resolves to individual points once the zoom can split them", () => {
    const spread = [at(0, 30.5, 50.4), at(1, -74.0, 40.7)];
    const features = clustersOf(spread, MAX_ZOOM);
    expect(features).toHaveLength(2);
    expect(features.every((f) => !("cluster" in f.properties))).toBe(true);
  });
});

describe("coverThumbs", () => {
  it("reads the cover indices back as thumbnails, cover first", () => {
    expect(coverThumbs([2, 0], oneSpot)).toEqual([oneSpot[2].thumb, oneSpot[0].thumb]);
  });

  it("leaves a pending preview undefined rather than guessing", () => {
    const points = [{ ...at(0, 30.5, 50.4), thumb: undefined }];
    expect(coverThumbs([0], points)).toEqual([undefined]);
  });
});
