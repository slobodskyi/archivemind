// Compiles a GeoNames city dump into the compact binary the worker's reverse
// geocoder loads at boot (apps/worker/data/places.bin.gz). Run by hand when
// refreshing the data — roughly annually; never by CI, never at container boot.
//
//   node apps/worker/scripts/build-geo-index.mjs
//   node apps/worker/scripts/build-geo-index.mjs --dataset cities15000
//
// Downloads are cached under scripts/.geonames-cache/ so a rebuild is offline.
// Output is byte-reproducible: rows are ordered by numeric geonameid and every
// input is pinned by sha256 in the header, so a rebuild that differs is a data
// change, not locale drift (an earlier draft sorted with localeCompare, whose
// result depends on the machine's ICU locale).
//
// Data: GeoNames (https://www.geonames.org), CC BY 4.0. See apps/worker/data/NOTICE.

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, ".geonames-cache");
const OUT = path.join(HERE, "..", "data", "places.bin.gz");
const BASE = "https://download.geonames.org/export/dump";
const FORMAT_VERSION = 3;

/** A district is not an answer to "where was this taken" — "Podil" and
 *  "Mitte" must lose to Kyiv and Berlin. Abandoned and destroyed places
 *  (PPLQ/PPLW) are deliberately KEPT: Chornobyl is exactly the kind of place
 *  this archive exists to document. */
const SKIP_FEATURE_CODES = new Set([
  "PPLX", // section of a populated place — districts, microdistricts
  "PPLS", // a *set* of populated places, not one of them
]);

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DATASET = argOf("dataset", "cities5000");

/** Big cities read better without their region ("Kyiv, Ukraine"), but only
 *  when the short form is unambiguous — see the collision pass below. */
const DROP_REGION_ABOVE = 200_000;

async function fetchCached(name) {
  fs.mkdirSync(CACHE, { recursive: true });
  const hit = path.join(CACHE, name);
  if (fs.existsSync(hit)) return fs.readFileSync(hit);
  const url = `${BASE}/${name}`;
  process.stdout.write(`  downloading ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(hit, buf);
  return buf;
}

/** GeoNames ships the city tables zipped; everything else is plain text. */
async function fetchTable(base) {
  if (!base.startsWith("cities")) return (await fetchCached(base)).toString("utf8");
  const zip = await fetchCached(`${base}.zip`);
  // Minimal ZIP reader: these archives hold one deflated entry, the .txt.
  const { inflateRawSync } = await import("node:zlib");
  const sig = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (sig !== 0) throw new Error(`${base}.zip: not a zip archive`);
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const compressed = zip.readUInt32LE(8) !== 0;
  const size = zip.readUInt32LE(18);
  const body = compressed ? inflateRawSync(zip.subarray(start)) : zip.subarray(start, start + size);
  return body.toString("utf8");
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function parseAdmin1(text) {
  const byCode = new Map();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [code, name] = line.split("\t");
    if (code && name) byCode.set(code, name);
  }
  return byCode;
}

function parseCountries(text) {
  const byIso = new Map();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols[0] && cols[4]) byIso.set(cols[0], cols[4]);
  }
  return byIso;
}

async function main() {
  process.stdout.write(`Building geo index from ${DATASET}\n`);
  const [citiesText, admin1Text, countryText] = await Promise.all([
    fetchTable(DATASET),
    fetchTable("admin1CodesASCII.txt"),
    fetchTable("countryInfo.txt"),
  ]);
  const admin1 = parseAdmin1(admin1Text);
  const countries = parseCountries(countryText);

  const rows = [];
  for (const line of citiesText.split("\n")) {
    if (!line) continue;
    const c = line.split("\t");
    // GeoNames column order: 0 id, 1 name, 4 lat, 5 lon, 6 class, 7 code,
    // 8 country iso2, 10 admin1 code, 14 population.
    const id = Number(c[0]);
    const lat = Number(c[4]);
    const lon = Number(c[5]);
    const iso2 = c[8];
    if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon) || !iso2) continue;
    if (SKIP_FEATURE_CODES.has(c[7])) continue;
    const name = c[1];
    if (!name) continue;
    rows.push({
      id,
      lat,
      lon,
      name,
      region: admin1.get(`${iso2}.${c[10]}`) ?? null,
      country: countries.get(iso2) ?? iso2,
      population: Number(c[14]) || 0,
    });
  }
  // Numeric geonameid: stable, and independent of the machine's locale.
  rows.sort((a, b) => a.id - b.id);

  // Short labels first, then re-add the region wherever a short label would
  // name two different places ("Suzhou, China" is two cities of millions).
  const shortLabel = (r) => `${r.name}, ${r.country}`;
  const longLabel = (r) => (r.region && r.region !== r.name ? `${r.name}, ${r.region}, ${r.country}` : shortLabel(r));
  const shortCount = new Map();
  for (const r of rows) {
    if (r.population >= DROP_REGION_ABOVE) shortCount.set(shortLabel(r), (shortCount.get(shortLabel(r)) ?? 0) + 1);
  }
  let ambiguous = 0;
  for (const r of rows) {
    const short = r.population >= DROP_REGION_ABOVE && shortCount.get(shortLabel(r)) === 1;
    if (r.population >= DROP_REGION_ABOVE && !short) ambiguous += 1;
    r.label = short ? shortLabel(r) : longLabel(r);
    // Where the settlement name ends, so the runtime can fall back to
    // "Zakarpattia, Ukraine" for a shot 16 km from the nearest village
    // rather than claiming it was taken in that village.
    r.coarseStart = Buffer.byteLength(`${r.name}, `, "utf8");
  }

  const n = rows.length;
  const lat = Buffer.alloc(n * 4);
  const lon = Buffer.alloc(n * 4);
  const population = Buffer.alloc(n * 4);
  const coarse = Buffer.alloc(n * 2);
  const offsets = Buffer.alloc((n + 1) * 4);
  const labels = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    // float32 keeps ~1 m of precision at these magnitudes and halves the file.
    lat.writeFloatLE(rows[i].lat, i * 4);
    lon.writeFloatLE(rows[i].lon, i * 4);
    // Feeds the runtime's "how far does this place extend" weighting, so a
    // city centre resolves to the city rather than to the nearest suburb.
    population.writeUInt32LE(Math.min(rows[i].population, 0xffffffff), i * 4);
    coarse.writeUInt16LE(Math.min(rows[i].coarseStart, 0xffff), i * 2);
    offsets.writeUInt32LE(cursor, i * 4);
    const bytes = Buffer.from(rows[i].label, "utf8");
    labels.push(bytes);
    cursor += bytes.length;
  }
  offsets.writeUInt32LE(cursor, n * 4);
  const labelBlob = Buffer.concat(labels, cursor);

  const header = Buffer.from(
    JSON.stringify({
      v: FORMAT_VERSION,
      n,
      dataset: DATASET,
      attribution: "GeoNames (https://www.geonames.org), CC BY 4.0",
      sources: {
        [DATASET]: sha256(citiesText),
        "admin1CodesASCII.txt": sha256(admin1Text),
        "countryInfo.txt": sha256(countryText),
      },
      labelBytes: cursor,
    }),
    "utf8",
  );
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32LE(header.length, 0);

  const raw = Buffer.concat([headerLen, header, lat, lon, population, coarse, offsets, labelBlob]);
  // level 9 + no mtime keeps the artifact byte-identical across rebuilds.
  const gz = gzipSync(raw, { level: 9 });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, gz);

  process.stdout.write(
    `  rows            ${n}\n` +
      `  ambiguous short ${ambiguous} (kept their region)\n` +
      `  raw             ${(raw.length / 1048576).toFixed(2)} MB\n` +
      `  gzipped         ${(gz.length / 1048576).toFixed(2)} MB → ${path.relative(process.cwd(), OUT)}\n` +
      `  sha256          ${sha256(gz)}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`build-geo-index failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
