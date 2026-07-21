import { describe, expect, it } from "vitest";
import { reverseGeocode } from "./geocode";

/** Runs against the real data/places.bin.gz — the point of these tests is that
 *  the shipped artifact answers correctly, so a fixture would test nothing. */

describe("reverseGeocode — real places", () => {
  it("names the city you are standing in, not the district", () => {
    // Central Kyiv is metres from "Stare Misto" and "Podil"; the answer people
    // expect is Kyiv. Berlin has the same trap with its Bezirke.
    expect(reverseGeocode(50.4501, 30.5234)).toMatchObject({ label: "Kyiv, Ukraine", precision: "place" });
    expect(reverseGeocode(52.52, 13.405)).toMatchObject({ label: "Berlin, Germany", precision: "place" });
  });

  it("keeps a big city's own outskirts inside it", () => {
    // Troieshchyna is 8 km out and still Kyiv, whereas nearest-point-wins would
    // hand it to whichever suburb centroid sits closest.
    expect(reverseGeocode(50.5106, 30.6015)).toMatchObject({ label: "Kyiv, Ukraine" });
  });

  it("names small towns, and disambiguates them by region", () => {
    expect(reverseGeocode(46.4825, 30.7233)).toMatchObject({ label: "Odesa, Ukraine" });
    expect(reverseGeocode(50.5484, 30.2124)).toMatchObject({ label: "Bucha, Kyiv Oblast, Ukraine" });
    expect(reverseGeocode(50.33069, 30.46836)).toMatchObject({ label: "Khotiv, Kyiv Oblast, Ukraine" });
  });

  it("keeps abandoned places — they are what this archive documents", () => {
    expect(reverseGeocode(51.27013, 30.21968)).toMatchObject({
      label: "Chornobyl, Kyiv Oblast, Ukraine",
      precision: "place",
    });
  });

  it("drops to the region rather than claiming a village it is not in", () => {
    // Deep in the Carpathians, 11 km from the nearest settlement.
    expect(reverseGeocode(48.16, 24.5)).toMatchObject({ label: "Zakarpattia, Ukraine", precision: "region" });
    // Two km outside Khotiv is not Khotiv, and certainly not Kyiv.
    expect(reverseGeocode(50.3122, 30.4536)).toMatchObject({ label: "Kyiv Oblast, Ukraine", precision: "region" });
  });

  it("reports the distance it matched at", () => {
    const hit = reverseGeocode(50.4501, 30.5234);
    expect(hit?.distanceKm).toBeGreaterThanOrEqual(0);
    expect(hit?.distanceKm).toBeLessThan(25);
  });
});

describe("reverseGeocode — refuses to guess", () => {
  it("returns null out at sea, in the desert and at the poles", () => {
    for (const [lat, lon] of [
      [43.5, 33.0], // middle of the Black Sea
      [0, -160], // middle of the Pacific
      [-75, 0], // Antarctica
      [90, 0], // north pole
      [-90, 180], // south pole
      [23.4162, 25.6628], // Sahara
      [44.428, -110.5885], // Yellowstone backcountry
    ]) {
      expect(reverseGeocode(lat, lon), `${lat},${lon}`).toBeNull();
    }
  });

  it("treats 0,0 as the zeroed EXIF field it almost always is", () => {
    expect(reverseGeocode(0, 0)).toBeNull();
  });

  it("rejects a half-populated coordinate pair instead of coercing it", () => {
    // The regression this guards: Number(null) === 0, so a row with a latitude
    // but no longitude used to geocode to a confident place on the Greenwich
    // meridian. exif.ts fills the two axes independently and the schema has no
    // both-or-neither constraint, so such rows are representable.
    expect(reverseGeocode(50.45, null)).toBeNull();
    expect(reverseGeocode(null, 30.52)).toBeNull();
    expect(reverseGeocode(50.45, "")).toBeNull();
    expect(reverseGeocode(50.45, undefined)).toBeNull();
  });

  it("never throws on hostile input", () => {
    for (const [lat, lon] of [
      [NaN, NaN],
      [Infinity, 0],
      ["50.45", "30.52"],
      [999, 999],
      [[50], [30]],
      [{}, {}],
      [true, false],
    ] as [unknown, unknown][]) {
      expect(() => reverseGeocode(lat, lon)).not.toThrow();
      expect(reverseGeocode(lat, lon)).toBeNull();
    }
  });

  it("handles the antimeridian without wrapping into the wrong hemisphere", () => {
    // Both points are open ocean; the failure mode being guarded is a flat
    // index answering with a settlement 6000 km away on the other side of 180°.
    expect(reverseGeocode(66.0, 179.9)).toBeNull();
    expect(reverseGeocode(-16.8, -179.98)).toBeNull();
  });
});

describe("reverseGeocode — determinism", () => {
  it("returns identical results for repeated lookups", () => {
    for (const [lat, lon] of [
      [50.4501, 30.5234],
      [48.16, 24.5],
      [41.0082, 28.9784],
    ]) {
      expect(reverseGeocode(lat, lon)).toEqual(reverseGeocode(lat, lon));
    }
  });
});
