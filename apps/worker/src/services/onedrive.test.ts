import { describe, expect, it, vi } from "vitest";
import {
  ONEDRIVE_ITEM_SELECT,
  ThrottleGate,
  classifyGraphStatus,
  exifFromFacets,
  mergeExifFallback,
  parseRefreshResponse,
  retryDelayMs,
  toOneDriveItem,
  type OneDriveItem,
} from "./onedrive";
import type { ParsedExif } from "./exif";

const item = (over: Partial<OneDriveItem> = {}): OneDriveItem => ({
  id: "i1",
  name: "DSC01.jpg",
  size: 100,
  mimeType: "image/jpeg",
  isFolder: false,
  childCount: null,
  downloadUrl: "https://files.example/x",
  path: null,
  photo: null,
  location: null,
  ...over,
});

const localExif = (over: Partial<ParsedExif> = {}): ParsedExif => ({
  taken_at: null,
  camera_make: null,
  camera_model: null,
  lens: null,
  gps_lat: null,
  gps_lon: null,
  iso: null,
  aperture: null,
  shutter: null,
  focal_length: null,
  raw: {},
  ...over,
});

describe("graph status + throttling (ADR 0047 S6)", () => {
  it("treats 503 as throttling, not just 429", () => {
    expect(classifyGraphStatus(429)).toBe("retry");
    // The docs list 503 alongside 429 for throttling. Reading only 429 as
    // "slow down" is how an app keeps hammering a service that asked it to stop.
    expect(classifyGraphStatus(503)).toBe("retry");
    expect(classifyGraphStatus(500)).toBe("retry");
    expect(classifyGraphStatus(404)).toBe("not_found");
    expect(classifyGraphStatus(401)).toBe("unauthorized");
    expect(classifyGraphStatus(403)).toBe("fatal");
    expect(classifyGraphStatus(200)).toBe("ok");
  });

  it("never waits less than Retry-After says", () => {
    // Honouring the header is not advisory: calling back early is documented
    // to get the app blocked for "abusive calling patterns".
    expect(retryDelayMs("10", 0)).toBe(10_000);
    expect(retryDelayMs("1", 5)).toBe(1000); // header wins even over a big attempt
    expect(retryDelayMs("100000", 0)).toBe(120_000); // but bounded
    // No header → our own backoff, which grows with the attempt
    expect(retryDelayMs(null, 0)).toBeGreaterThanOrEqual(1500);
    expect(retryDelayMs(null, 3)).toBeGreaterThan(retryDelayMs("0.0001", 3));
    expect(retryDelayMs("nonsense", 0)).toBeGreaterThanOrEqual(1500);
  });

  it("the gate pauses everything and keeps the longest pause", () => {
    const gate = new ThrottleGate();
    expect(gate.remainingMs()).toBe(0);
    const now = Date.now();
    gate.pauseFor(5000);
    expect(gate.remainingMs(now)).toBeGreaterThan(4000);
    // A shorter pause must not shorten a longer one already in effect —
    // otherwise one lenient response cancels a severe one.
    gate.pauseFor(100);
    expect(gate.remainingMs(now)).toBeGreaterThan(4000);
    gate.pauseFor(20_000);
    expect(gate.remainingMs(now)).toBeGreaterThan(19_000);
  });

  it("wait() resolves immediately when clear", async () => {
    const gate = new ThrottleGate();
    const spy = vi.spyOn(global, "setTimeout");
    await gate.wait();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("token refresh (ADR 0047 §8.1)", () => {
  it("surfaces a rotated refresh token", () => {
    // Microsoft rotates on use. A caller that ignores the new token has a
    // connection that dies silently when the access token next lapses.
    const parsed = parseRefreshResponse(200, {
      access_token: "at",
      expires_in: 3600,
      refresh_token: "rt-new",
    });
    expect(parsed).toMatchObject({ ok: true, accessToken: "at", rotatedRefresh: "rt-new" });
  });

  it("tolerates a response with no rotation and defaults the lifetime", () => {
    const parsed = parseRefreshResponse(200, { access_token: "at" });
    expect(parsed).toMatchObject({ ok: true, rotatedRefresh: null, expiresInS: 3600 });
  });

  it("distinguishes a revoked grant from a transient failure", () => {
    expect(parseRefreshResponse(400, { error: "invalid_grant" })).toEqual({
      ok: false,
      code: "onedrive_connection_revoked",
    });
    expect(parseRefreshResponse(500, {})).toEqual({
      ok: false,
      code: "onedrive_token_refresh_failed",
    });
  });
});

describe("driveItem shaping", () => {
  it("selects the download URL, because it must be resolved per fetch", () => {
    // It expires in minutes — that is why it is on the item query rather than
    // parked in a job payload the way Dropbox's 4 h links are.
    expect(ONEDRIVE_ITEM_SELECT).toContain("@microsoft.graph.downloadUrl");
    expect(ONEDRIVE_ITEM_SELECT).toContain("photo");
    expect(ONEDRIVE_ITEM_SELECT).toContain("location");
  });

  it("maps files and folders, and refuses a row with no id", () => {
    const file = toOneDriveItem({
      id: "i1",
      name: "a.jpg",
      size: 12,
      file: { mimeType: "image/jpeg" },
      "@microsoft.graph.downloadUrl": "https://files/x",
    });
    expect(file).toMatchObject({ isFolder: false, downloadUrl: "https://files/x", size: 12 });

    const folder = toOneDriveItem({ id: "f1", name: "2024", folder: { childCount: 3 } });
    expect(folder).toMatchObject({ isFolder: true, childCount: 3, downloadUrl: null });

    expect(toOneDriveItem({ name: "orphan" })).toBeNull();
  });
});

describe("photo facets as a fallback, never a source of truth (ADR 0047 §8.4)", () => {
  it("converts the exposure fraction into our shutter string", () => {
    const facets = exifFromFacets(
      item({
        photo: {
          takenDateTime: "2024-05-01T10:00:00Z",
          cameraMake: "NIKON",
          cameraModel: "Z 8",
          fNumber: 2.8,
          focalLength: 35,
          iso: 400,
          exposureNumerator: 1,
          exposureDenominator: 250,
        },
        location: { latitude: 50.45, longitude: 30.52 },
      }),
    );
    expect(facets).toMatchObject({
      camera_make: "NIKON",
      camera_model: "Z 8",
      aperture: "f/2.8",
      shutter: "1/250",
      focal_length: "35mm",
      iso: 400,
      gps_lat: 50.45,
      gps_lon: 30.52,
    });
    expect(facets?.taken_at?.toISOString()).toBe("2024-05-01T10:00:00.000Z");
  });

  it("returns null when Graph offered no facets at all", () => {
    expect(exifFromFacets(item())).toBeNull();
  });

  it("handles the business-account case: takenDateTime and nothing else", () => {
    // Documented behaviour, not a guess — OneDrive for Business and SharePoint
    // return ONLY takenDateTime. This is the case a facets-first design would
    // have shipped as a near-empty archive.
    const facets = exifFromFacets(item({ photo: { takenDateTime: "2024-05-01T10:00:00Z" } }));
    expect(facets?.taken_at).toBeInstanceOf(Date);
    expect(facets?.camera_make).toBeNull();
    expect(facets?.aperture).toBeNull();
  });

  it("rejects an unparseable takenDateTime rather than storing Invalid Date", () => {
    expect(exifFromFacets(item({ photo: { takenDateTime: "not-a-date" } }))?.taken_at).toBeNull();
  });

  it("local EXIF wins on every field it answered", () => {
    const merged = mergeExifFallback(
      localExif({ camera_make: "Canon", iso: 100, taken_at: new Date("2020-01-01T00:00:00Z") }),
      { camera_make: "NIKON", iso: 400, taken_at: new Date("2024-05-01T00:00:00Z"), aperture: "f/2.8" },
    );
    expect(merged?.camera_make).toBe("Canon");
    expect(merged?.iso).toBe(100);
    expect(merged?.taken_at?.getUTCFullYear()).toBe(2020);
    // ...and the gap it left is filled
    expect(merged?.aperture).toBe("f/2.8");
  });

  it("treats GPS as a pair, never mixing sources", () => {
    // Taking a latitude from one source and a longitude from the other would
    // invent a coordinate that neither reported.
    const merged = mergeExifFallback(localExif({ gps_lat: 10, gps_lon: null }), {
      gps_lat: 50,
      gps_lon: 30,
    });
    expect(merged?.gps_lat).toBe(10);
    expect(merged?.gps_lon).toBeNull();

    const filled = mergeExifFallback(localExif(), { gps_lat: 50, gps_lon: 30 });
    expect(filled).toMatchObject({ gps_lat: 50, gps_lon: 30 });
  });

  it("builds a row from facets alone when local extraction found nothing", () => {
    // Better a date from Graph than a photo with no date at all.
    const merged = mergeExifFallback(null, { taken_at: new Date("2024-05-01T00:00:00Z") });
    expect(merged?.taken_at).toBeInstanceOf(Date);
    expect(merged?.raw).toEqual({});
  });

  it("passes local through untouched when there are no facets", () => {
    const local = localExif({ camera_make: "Canon" });
    expect(mergeExifFallback(local, null)).toBe(local);
    expect(mergeExifFallback(null, null)).toBeNull();
  });
});
