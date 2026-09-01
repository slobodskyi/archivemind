import type { AssetLabel } from "@archivemind/shared";
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
  /** Colour label (ADR 0040), or null when nobody has marked this photo. The
   *  map reads it for the same reason the canvas tile does: a colour is a
   *  marker you should see on a photo wherever the photo appears, and Map was
   *  the one surface that filtered BY the label without ever showing it. */
  label: AssetLabel | null;
}

/** west, south, east, north — the order supercluster and MapLibre both use. */
export type GeoBounds = [number, number, number, number];

/** How many photos one cluster marker tiles: a full 2×2 mosaic. */
export const CLUSTER_COVER_LIMIT = 4;

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
      label: p.label ?? null,
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
 *  running away — 200 photos and 20 000 look the same at a glance anyway.
 *
 *  A cluster is wider than the 58–82 px it used to be because it now tiles its
 *  photos rather than showing one cover: a 2×2 mosaic halves every edge, so the
 *  marker has to grow or each cell drops under ~35 px and stops being a
 *  photograph. A single photo is untouched — it has nothing to divide. */
export function markerSize(count: number): number {
  if (count <= 1) return 52;
  if (count < 10) return 72;
  if (count < 50) return 80;
  if (count < 200) return 86;
  return 92;
}

/** How many photos the mosaic tiles: what the cluster holds, up to the cover
 *  limit. Deliberately not always four — three cells behind a cluster of two
 *  would draw a place fuller than it is. */
export function mosaicCells(count: number): number {
  return Math.max(1, Math.min(count, CLUSTER_COVER_LIMIT));
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

/** Merge two ascending index lists into the `CLUSTER_COVER_LIMIT` smallest.
 *
 *  A cluster carries INDICES into the newest-first point array rather than
 *  thumbnail URLs: a presigned URL is ~500 bytes and the cluster tree holds a
 *  node per zoom level, so copying URLs up the tree would duplicate the whole
 *  archive's worth of them several times over. Smallest-index-wins is also what
 *  makes the mosaic *meaningful* — the newest photos at that place, rather than
 *  whichever leaves supercluster's spatially-sorted tree happened to reach
 *  first. */
export function mergeCoverIndices(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (out.length < CLUSTER_COVER_LIMIT && (i < a.length || j < b.length)) {
    if (j >= b.length || (i < a.length && a[i] <= b[j])) out.push(a[i++]);
    else out.push(b[j++]);
  }
  return out;
}
