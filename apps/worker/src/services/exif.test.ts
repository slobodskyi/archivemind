import { describe, expect, it } from "vitest";
import type { Tags } from "exiftool-vendored";
import {
  formatAperture,
  formatFocalLength,
  formatShutter,
  fromExifToolTags,
  parseExposure,
  parseMillimetres,
  signedCoordinate,
} from "./exif";

/** These guard the seam between the two metadata readers: exifr hands back
 *  numbers and a Date, ExifTool hands back display strings and an
 *  ExifDateTime, and both have to land on identical stored columns. */

describe("parseExposure", () => {
  it("reads ExifTool's fraction string", () => {
    expect(parseExposure("1/50")).toBeCloseTo(0.02);
    expect(parseExposure("1/250")).toBeCloseTo(0.004);
    expect(parseExposure(" 1 / 4 ")).toBeCloseTo(0.25);
  });

  it("passes exifr's number straight through", () => {
    expect(parseExposure(0.004)).toBe(0.004);
    expect(parseExposure(2.5)).toBe(2.5);
  });

  it("reads a decimal string, and refuses everything else", () => {
    expect(parseExposure("2.5")).toBe(2.5);
    expect(parseExposure("1/0")).toBeUndefined();
    expect(parseExposure("")).toBeUndefined();
    expect(parseExposure(null)).toBeUndefined();
    expect(parseExposure({})).toBeUndefined();
  });

  it("round-trips to the same display string from either source", () => {
    // The regression this pins: an iPhone shot must read "1/50" whichever
    // reader produced it.
    expect(formatShutter(parseExposure("1/50"))).toBe("1/50");
    expect(formatShutter(parseExposure(0.02))).toBe("1/50");
  });
});

describe("parseMillimetres", () => {
  it("strips ExifTool's unit suffix", () => {
    expect(parseMillimetres("6.0 mm")).toBe(6);
    expect(parseMillimetres("35mm")).toBe(35);
    expect(parseMillimetres(35)).toBe(35);
  });

  it("refuses what it cannot read", () => {
    expect(parseMillimetres("unknown")).toBeUndefined();
    expect(parseMillimetres(undefined)).toBeUndefined();
  });

  it("agrees with the exifr path on the stored string", () => {
    expect(formatFocalLength(parseMillimetres("6.0 mm"))).toBe("6mm");
    expect(formatFocalLength(parseMillimetres(6))).toBe("6mm");
  });
});

describe("signedCoordinate", () => {
  it("keeps northern and eastern coordinates positive", () => {
    expect(signedCoordinate(50.441372, "N", "S")).toBeCloseTo(50.441372);
    expect(signedCoordinate(30.522422, "E", "W")).toBeCloseTo(30.522422);
  });

  it("applies the hemisphere ref to a magnitude", () => {
    // Getting this wrong mirrors a photo onto the opposite hemisphere.
    expect(signedCoordinate(33.9249, "S", "S")).toBeCloseTo(-33.9249);
    expect(signedCoordinate(18.4241, "W", "W")).toBeCloseTo(-18.4241);
  });

  it("respects an already-signed value when the ref is absent", () => {
    expect(signedCoordinate(-33.9249, undefined, "S")).toBeCloseTo(-33.9249);
    expect(signedCoordinate(-18.4241, null, "W")).toBeCloseTo(-18.4241);
  });

  it("does not double-negate a signed value that also carries its ref", () => {
    expect(signedCoordinate(-33.9249, "S", "S")).toBeCloseTo(-33.9249);
  });

  it("returns null for anything that is not a finite number", () => {
    for (const v of [undefined, null, "50.4", NaN, Infinity, {}]) {
      expect(signedCoordinate(v, "N", "S"), String(v)).toBeNull();
    }
  });
});

describe("fromExifToolTags", () => {
  /** Shaped after the real iPhone 17 HEIC that exposed the bug — exifr threw
   *  "Unknown file format" on it while ExifTool read 317 tags. */
  const iphone = {
    Make: "Apple",
    Model: "iPhone 17",
    LensModel: "iPhone 17 back dual wide camera 5.96mm f/1.6",
    DateTimeOriginal: { toDate: () => new Date("2026-07-21T16:59:20.590Z") },
    ISO: 160,
    FNumber: 1.6,
    ExposureTime: "1/50",
    FocalLength: "6.0 mm",
    GPSLatitude: 50.441372,
    GPSLatitudeRef: "N",
    GPSLongitude: 30.522422,
    GPSLongitudeRef: "E",
  } as unknown as Tags;

  it("maps an iPhone capture onto every stored column", () => {
    const exif = fromExifToolTags(iphone);
    expect(exif.taken_at?.toISOString()).toBe("2026-07-21T16:59:20.590Z");
    expect(exif.camera_make).toBe("Apple");
    expect(exif.camera_model).toBe("iPhone 17");
    expect(exif.lens).toContain("iPhone 17 back dual wide");
    expect(exif.gps_lat).toBeCloseTo(50.441372);
    expect(exif.gps_lon).toBeCloseTo(30.522422);
    expect(exif.iso).toBe(160);
    expect(exif.aperture).toBe("f/1.6");
    expect(exif.shutter).toBe("1/50");
    expect(exif.focal_length).toBe("6mm");
  });

  it("falls back to CreateDate when there is no DateTimeOriginal", () => {
    const exif = fromExifToolTags({
      CreateDate: { toDate: () => new Date("2020-01-02T03:04:05Z") },
    } as unknown as Tags);
    expect(exif.taken_at?.toISOString()).toBe("2020-01-02T03:04:05.000Z");
  });

  it("accepts a plain Date, which some tags decode to", () => {
    const exif = fromExifToolTags({ DateTimeOriginal: new Date("2021-05-06T07:08:09Z") } as unknown as Tags);
    expect(exif.taken_at?.toISOString()).toBe("2021-05-06T07:08:09.000Z");
  });

  it("yields nulls, never NaN or an Invalid Date, for an empty file", () => {
    const exif = fromExifToolTags({} as Tags);
    expect(exif.taken_at).toBeNull();
    expect(exif.camera_make).toBeNull();
    expect(exif.gps_lat).toBeNull();
    expect(exif.gps_lon).toBeNull();
    expect(exif.iso).toBeNull();
    expect(exif.aperture).toBeNull();
    expect(exif.shutter).toBeNull();
    expect(exif.focal_length).toBeNull();
  });

  it("ignores an unparseable date rather than storing Invalid Date", () => {
    const exif = fromExifToolTags({
      DateTimeOriginal: { toDate: () => new Date("nonsense") },
    } as unknown as Tags);
    expect(exif.taken_at).toBeNull();
  });

  it("blanks whitespace-only strings", () => {
    const exif = fromExifToolTags({ Make: "   ", Model: "" } as unknown as Tags);
    expect(exif.camera_make).toBeNull();
    expect(exif.camera_model).toBeNull();
  });

  it("stores a southern/western capture in the right hemisphere", () => {
    const exif = fromExifToolTags({
      GPSLatitude: 33.9249,
      GPSLatitudeRef: "S",
      GPSLongitude: 18.4241,
      GPSLongitudeRef: "W",
    } as unknown as Tags);
    expect(exif.gps_lat).toBeCloseTo(-33.9249); // Cape Town, not Lebanon
    expect(exif.gps_lon).toBeCloseTo(-18.4241);
  });
});

describe("formatters", () => {
  it("keep their existing contracts", () => {
    expect(formatAperture(2.8)).toBe("f/2.8");
    expect(formatAperture(0)).toBeNull();
    expect(formatShutter(2.5)).toBe("2.5s");
    expect(formatFocalLength(35)).toBe("35mm");
  });
});
