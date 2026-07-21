import type { Photo } from "@/types";

/** Pure geo helpers for the Map view (ADR 0027). Everything here is
 *  deterministic and browser-free so it can be unit-tested; MapLibre and
 *  supercluster live in components/map/. */

export interface GeoPoint {
  assetId: string;
  /** GeoJSON order — longitude first. Mixing these up is the classic bug: it
   *  puts Kyiv in the Indian Ocean rather than failing loudly. */
  lng: number;
  lat: number;
  /** Presigned 256 px thumb; absent while previews are still being made. */
  thumb?: string;
  filename: string;
}

/** west, south, east, north — the order supercluster and MapLibre both use. */
export type GeoBounds = [number, number, number, number];

function isPlottable(lat: number | null, lon: number | null): boolean {
  if (lat === null || lon === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  // Exactly 0,0 is a zeroed EXIF field far more often than it is a photo taken
  // in the Gulf of Guinea; plotting it would put a phantom cluster there.
  return !(lat === 0 && lon === 0);
}

/** The subset of a project's photos that can actually be placed on a map.
 *  Order follows the input, so the map is as deterministic as the canvas. */
export function geoPointsFromPhotos(photos: readonly Photo[]): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const p of photos) {
    const { gpsLat, gpsLon } = p.exif;
    if (!isPlottable(gpsLat, gpsLon)) continue;
    points.push({
      assetId: p.id,
      lng: gpsLon as number,
      lat: gpsLat as number,
      thumb: p.src,
      filename: p.filename,
    });
  }
  return points;
}

/** Bounding box of the points, or null when there are none to frame. */
export function boundsOf(points: readonly GeoPoint[]): GeoBounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  // A single point (or a perfectly aligned row) has zero extent, which
  // fitBounds would answer with maximum zoom; pad it into a real box.
  const padLng = east - west < 0.01 ? 0.01 : 0;
  const padLat = north - south < 0.01 ? 0.01 : 0;
  return [west - padLng, south - padLat, east + padLng, north + padLat];
}

/** Marker diameter in px. Bigger clusters read as heavier without the scale
 *  running away — 200 photos and 20 000 look the same at a glance anyway. */
export function markerSize(count: number): number {
  if (count <= 1) return 52;
  if (count < 10) return 58;
  if (count < 50) return 66;
  if (count < 200) return 74;
  return 82;
}

/** Thin-space thousands, the way the counts read in Apple Photos: "27 027".
 *  A regular space would let the badge wrap. */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  return Math.round(count).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** "3 of 128 files have no location" — the honest footnote for an archive
 *  whose photos mostly came through messengers that strip EXIF. */
export function missingLocationLabel(total: number, plotted: number): string | null {
  const missing = total - plotted;
  if (missing <= 0) return null;
  // "1 of 2 files has" — the noun counts the set, the verb counts the subset.
  return `${formatCount(missing)} of ${formatCount(total)} files ${missing === 1 ? "has" : "have"} no location`;
}
