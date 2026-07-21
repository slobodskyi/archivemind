import { describe, expect, it } from "vitest";
import { formatGps } from "./format";

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
