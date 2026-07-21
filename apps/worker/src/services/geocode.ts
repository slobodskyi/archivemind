import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import KDBush from "kdbush";

/** Offline reverse geocoding: GPS coordinates → "Odesa, Ukraine", the human
 *  place label stored in `asset_exif.gps_label` (spec §8.1). The label feeds
 *  caption prompts and the `gps_label ILIKE` half of search, so a WRONG label
 *  is worse than none — everything here is built to return null rather than
 *  guess. See ADR 0026.
 *
 *  The index is a GeoNames extract compiled into data/places.bin.gz by
 *  scripts/build-geo-index.mjs. No network, no API key, no per-lookup I/O. */

/** Beyond this the nearest settlement stops being where the photo was taken.
 *  Tuned deliberately tight: at 50 km both Pripyat and Chornobyl resolve to
 *  Slavutych — one label, three very different places, and it would flow
 *  straight into an AI caption. Wilderness shots get no label instead. */
const MAX_DISTANCE_KM = 25;

/** Nearest-by-distance alone answers the wrong question: standing in central
 *  Kyiv, the closest *point* is whichever suburb's centroid happens to sit
 *  nearby, not Kyiv. So each place gets an effective radius that grows with
 *  its population (settled area scales roughly with people, radius with its
 *  square root) and candidates compete on distance/radius. Calibrated so
 *  Kyiv's 2.95 M reaches ~14.5 km — far enough to hold its own outskirts,
 *  short of swallowing the villages beyond them — while a 1 500-person town
 *  reaches ~1.1 km. */
const PLACE_RADIUS_BASE_KM = 0.8;
const PLACE_RADIUS_KM_PER_SQRT_POP = 0.008;
const MAX_PLACE_RADIUS_KM = 16;

const EARTH_RADIUS_KM = 6371;
/** One degree of latitude, everywhere. Longitude shrinks by cos(lat). */
const KM_PER_DEG_LAT = 111.32;
/** Past this latitude the cos(lat) longitude window explodes; the band is so
 *  narrow by then that scanning its whole longitude range is cheaper. */
const POLAR_LAT = 85;

export interface GeocodeHit {
  /** "Odesa, Ukraine" at place precision, "Zakarpattia, Ukraine" at region. */
  label: string;
  /** Great-circle distance to the matched settlement; <= MAX_DISTANCE_KM. */
  distanceKm: number;
  /** "place" = the shot is inside that settlement's own footprint; "region" =
   *  it is out in the country somewhere near it, so only the region is claimed. */
  precision: "place" | "region";
}

interface PlaceIndex {
  lat: Float32Array;
  lon: Float32Array;
  population: Uint32Array;
  coarse: Uint16Array;
  offsets: Uint32Array;
  labels: Buffer;
  tree: KDBush;
  rows: number;
}

/** The artifact sits at the package root's data/, but this module runs from
 *  two different depths — src/services/ under tsx and vitest, dist/ once tsup
 *  has bundled it — so the package root is found by walking up rather than
 *  hardcoded. */
function resolveDataFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const up of ["..", "../..", "../../.."]) {
    const candidate = path.join(here, up, "data", "places.bin.gz");
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(here, "..", "data", "places.bin.gz"); // report the expected path
}

const SUPPORTED_FORMAT = 3;

let index: PlaceIndex | null = null;
let loadAttempted = false;

/** Decodes the artifact, validating every length before trusting it — a
 *  truncated file, an LFS pointer or a stale format must degrade to "no
 *  labels", never take ingest/analyze/caption down with it. */
function loadIndex(): PlaceIndex {
  const gz = fs.readFileSync(resolveDataFile());
  const raw = gunzipSync(gz);
  if (raw.length < 4) throw new Error("file shorter than its header length");
  const headerLen = raw.readUInt32LE(0);
  if (headerLen <= 0 || headerLen > raw.length - 4) throw new Error(`implausible header length ${headerLen}`);
  const header = JSON.parse(raw.subarray(4, 4 + headerLen).toString("utf8")) as {
    v?: number;
    n?: number;
    labelBytes?: number;
    dataset?: string;
  };
  if (header.v !== SUPPORTED_FORMAT) throw new Error(`format v${header.v}, expected v${SUPPORTED_FORMAT}`);
  const n = header.n;
  const labelBytes = header.labelBytes;
  if (!Number.isInteger(n) || n! <= 0) throw new Error(`bad row count ${n}`);
  if (!Number.isInteger(labelBytes) || labelBytes! < 0) throw new Error(`bad label size ${labelBytes}`);

  const rows = n as number;
  const base = 4 + headerLen;
  const expected = base + rows * 4 * 3 + rows * 2 + (rows + 1) * 4 + (labelBytes as number);
  if (raw.length !== expected) throw new Error(`length ${raw.length}, expected ${expected}`);

  // Subarray views share the decompressed buffer — no per-row JS strings, so
  // 161k places cost megabytes rather than tens of them. Labels are decoded
  // one at a time, only for the row that actually wins.
  let at = base;
  const lat = new Float32Array(raw.buffer, raw.byteOffset + at, rows);
  at += rows * 4;
  const lon = new Float32Array(raw.buffer, raw.byteOffset + at, rows);
  at += rows * 4;
  const population = new Uint32Array(raw.buffer, raw.byteOffset + at, rows);
  at += rows * 4;
  const coarse = new Uint16Array(raw.buffer, raw.byteOffset + at, rows);
  at += rows * 2;
  const offsets = new Uint32Array(raw.buffer, raw.byteOffset + at, rows + 1);
  at += (rows + 1) * 4;
  const labels = raw.subarray(at);

  const tree = new KDBush(rows);
  for (let i = 0; i < rows; i++) tree.add(lon[i], lat[i]);
  tree.finish();
  return { lat, lon, population, coarse, offsets, labels, tree, rows };
}

function getIndex(): PlaceIndex | null {
  if (loadAttempted) return index;
  loadAttempted = true;
  try {
    const loaded = loadIndex();
    index = loaded;
    console.log(`[geocode] index ready — ${loaded.rows} places`);
  } catch (e) {
    // Deliberately non-fatal: no geo labels is a degraded archive, a crashed
    // worker is a stopped one.
    index = null;
    console.error(`[geocode] index unavailable (${e instanceof Error ? e.message : String(e)}) — labels disabled`);
  }
  return index;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Rejects anything that isn't a genuine pair of coordinates. Note the strict
 *  typeof rather than Number(): `Number(null)` is 0, so a half-populated row
 *  (`gps_lat` set, `gps_lon` null — the schema permits it, and exif.ts fills
 *  the two axes independently) would otherwise geocode to a confident, wholly
 *  fictional place on the Greenwich meridian. */
function validPair(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    // 0,0 is a real spot in the Gulf of Guinea, but in EXIF it is overwhelmingly
    // a zeroed-out field. Nothing in our corpus is worth a label there.
    !(lat === 0 && lon === 0)
  );
}

/** Nearest settlement within MAX_DISTANCE_KM, or null. Never throws. */
export function reverseGeocode(lat: unknown, lon: unknown): GeocodeHit | null {
  if (!validPair(lat, lon)) return null;
  const latitude = lat;
  const longitude = lon as number;
  const idx = getIndex();
  if (!idx) return null;

  try {
    const dLat = MAX_DISTANCE_KM / KM_PER_DEG_LAT;
    const cos = Math.cos((latitude * Math.PI) / 180);
    const dLon =
      Math.abs(latitude) >= POLAR_LAT || cos <= 0 ? 360 : Math.min(360, MAX_DISTANCE_KM / (KM_PER_DEG_LAT * cos));
    const minLat = latitude - dLat;
    const maxLat = latitude + dLat;

    const candidates: number[] = [];
    if (dLon >= 180) {
      candidates.push(...idx.tree.range(-180, minLat, 180, maxLat));
    } else {
      candidates.push(...idx.tree.range(longitude - dLon, minLat, longitude + dLon, maxLat));
      // A window straddling the antimeridian is two windows in a flat index.
      if (longitude - dLon < -180) candidates.push(...idx.tree.range(longitude - dLon + 360, minLat, 180, maxLat));
      if (longitude + dLon > 180) candidates.push(...idx.tree.range(-180, minLat, longitude + dLon - 360, maxLat));
    }

    // Two winners are tracked: the place we are plausibly *inside* (best
    // score), and the merely closest one. Ties break on row order (geonameid),
    // so the result is deterministic.
    let insideId = -1;
    let insideKm = Infinity;
    let bestScore = Infinity;
    let nearestId = -1;
    let nearestKm = Infinity;
    for (const i of candidates) {
      const km = haversineKm(latitude, longitude, idx.lat[i], idx.lon[i]);
      if (km > MAX_DISTANCE_KM) continue;
      if (km < nearestKm) {
        nearestKm = km;
        nearestId = i;
      }
      const radius = Math.min(
        MAX_PLACE_RADIUS_KM,
        PLACE_RADIUS_BASE_KM + PLACE_RADIUS_KM_PER_SQRT_POP * Math.sqrt(idx.population[i]),
      );
      const score = km / radius;
      if (score < bestScore) {
        bestScore = score;
        insideKm = km;
        insideId = i;
      }
    }

    // Inside a place's own radius → name it. Otherwise the honest answer is
    // the region, not the nearest village 16 km up the valley.
    if (insideId >= 0 && bestScore <= 1) {
      const label = idx.labels.toString("utf8", idx.offsets[insideId], idx.offsets[insideId + 1]);
      return label ? { label, distanceKm: Math.round(insideKm * 10) / 10, precision: "place" } : null;
    }
    if (nearestId >= 0) {
      const start = idx.offsets[nearestId] + idx.coarse[nearestId];
      const end = idx.offsets[nearestId + 1];
      const label = start < end ? idx.labels.toString("utf8", start, end) : "";
      return label ? { label, distanceKm: Math.round(nearestKm * 10) / 10, precision: "region" } : null;
    }
    return null;
  } catch (e) {
    console.error(`[geocode] lookup failed (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

/** Test seam: forget the cached index so a fixture can be re-read. */
export function resetGeocodeIndexForTests(): void {
  index = null;
  loadAttempted = false;
}
