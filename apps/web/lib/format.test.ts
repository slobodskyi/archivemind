import { describe, expect, it } from "vitest";
import { exifClipboardText, formatGps } from "./format";

describe("formatGps", () => {
  it("joins coordinates with the reverse-geocoded label", () => {
    expect(formatGps({ gpsLat: 50.4501, gpsLon: 30.5234, gpsLabel: "Kyiv, Ukraine" })).toBe(
      "50.4501, 30.5234 · Kyiv, Ukraine",
    );
  });

  it("shows bare coordinates while the label is still unset", () => {
    expect(formatGps({ gpsLat: 46.4825, gpsLon: 30.7233, gpsLabel: "" })).toBe("46.4825, 30.7233");
    expect(formatGps({ gpsLat: 46.4825, gpsLon: 30.7233, gpsLabel: "   " })).toBe("46.4825, 30.7233");
  });

  it("keeps 0,0 — the Gulf of Guinea is a real place, unlike a missing fix", () => {
    expect(formatGps({ gpsLat: 0, gpsLon: 0, gpsLabel: "" })).toBe("0.0000, 0.0000");
  });

  it("falls back to an em dash when the file carries no GPS", () => {
    expect(formatGps({ gpsLat: null, gpsLon: null, gpsLabel: "" })).toBe("—");
  });

  it("treats a half-missing fix as no fix, but still shows a manual label", () => {
    expect(formatGps({ gpsLat: 50.45, gpsLon: null, gpsLabel: "" })).toBe("—");
    expect(formatGps({ gpsLat: null, gpsLon: null, gpsLabel: "Odesa, Ukraine" })).toBe("Odesa, Ukraine");
  });

  it("rounds long float noise to four decimals (~11 m)", () => {
    expect(formatGps({ gpsLat: 50.450100000001, gpsLon: -30.52339999999, gpsLabel: "" })).toBe(
      "50.4501, -30.5234",
    );
  });
});

describe("exifClipboardText", () => {
  const exif = {
    camera: "Canon EOS R5",
    lens: "RF 24-70mm F2.8",
    dateTaken: "2026-06-17 21:10",
    gpsLat: 50.4501,
    gpsLon: 30.5234,
    gpsLabel: "Kyiv, Ukraine",
    iso: 400,
    aperture: "f/2.8",
    shutter: "1/250",
    editedFields: [],
    takenAtIso: "2026-06-17T18:10:00.000Z",
  };

  it("writes the filename, then one line per field that has a value", () => {
    expect(exifClipboardText({ filename: "IMG_4675.jpg", exif })).toBe(
      [
        "IMG_4675.jpg",
        "Camera: Canon EOS R5",
        "Lens: RF 24-70mm F2.8",
        "Date: 2026-06-17 21:10",
        "GPS: 50.4501, 30.5234 · Kyiv, Ukraine",
        "ISO: 400",
        "Aperture: f/2.8",
        "Shutter: 1/250",
      ].join("\n"),
    );
  });

  it("drops the em dash — it is the drawer's 'no value' glyph, not a value", () => {
    const empty = { ...exif, camera: "—", lens: "—", aperture: "—", shutter: "—", gpsLat: null, gpsLon: null, gpsLabel: "" };
    expect(exifClipboardText({ filename: "IMG_4675.jpg", exif: empty })).toBe(
      ["IMG_4675.jpg", "Date: 2026-06-17 21:10", "ISO: 400"].join("\n"),
    );
  });

  it("drops ISO 0 — the reader's stand-in for a file that records no ISO", () => {
    expect(exifClipboardText({ filename: "a.jpg", exif: { ...exif, iso: 0 } })).not.toContain("ISO");
  });

  it("degrades to the filename alone when the file carries no metadata", () => {
    const none = {
      ...exif,
      camera: "—",
      lens: "—",
      dateTaken: "",
      aperture: "—",
      shutter: "—",
      iso: 0,
      gpsLat: null,
      gpsLon: null,
      gpsLabel: "",
    };
    expect(exifClipboardText({ filename: "scan.tif", exif: none })).toBe("scan.tif");
  });
});
