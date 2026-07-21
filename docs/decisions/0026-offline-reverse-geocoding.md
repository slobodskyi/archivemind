# 0026. Offline reverse geocoding, and a label that refuses to guess

Date: 2026-07-21

Status: Accepted

## Context

`asset_exif.gps_lat` / `gps_lon` have been populated since the first ingest — for
uploads, Drive and Dropbox imports alike, and for HEIC and RAW, because EXIF is
read from the original bytes before any decode. `asset_exif.gps_label` has
existed alongside them for just as long and has never been written by anything.

Three features are already built against that empty column:

- `search_assets()` matches place terms with `ex.gps_label ilike '%'||pt||'%'`
  and returns it as `matched_place` (migration `20260717000001`);
- the caption prompt injects `Location: ${gps_label}` when present
  (`handlers/caption.ts`) — a line that never fires today;
- the drawer's GPS row shows it.

And a fourth is about to be: a real geographic Map view needs somewhere to put
a human place name.

The obvious move is a geocoding API (Google, Mapbox, Nominatim). We rejected it
on three grounds. It puts a network call in the ingest hot path, where the
worker already runs sequentially to bound HEIC decode memory. It sends our
users' photo coordinates to a third party — for an archive holding frontline
material, the location of a photograph can be the most sensitive thing about
it. And it adds a paid dependency to a step that must not fail.

So: offline. Four candidates were evaluated empirically on a fixed set of 15
coordinates including deliberately hostile ones.

- **`offline-geocode-city`** — rejected. Hard-crashes with
  `RangeError: Maximum call stack size exceeded` on `(0, 0)` and on mid-Pacific
  coordinates, and with no distance cutoff it answered "Karatepe, Turkey" for a
  point in the middle of the Black Sea and "Scarborough, United Kingdom" for one
  off Chukotka.
- **`offline-geocoder`** — rejected. Depends on `sqlite3@4` (2018), which has no
  prebuilt binary for Node 22 and fails to compile from source without adding
  Python and a toolchain to the image.
- **`local-reverse-geocoder`** — works, but downloads 2.4 GB on first use unless
  pre-seeded through an undocumented filename fallback, costs ~126 MB RSS and
  ~2 s per boot, and answers with city *districts* ("Stare Misto" for Kyiv).
- **Compile our own index** — chosen.

## Decision

**A GeoNames extract, compiled into a committed binary, queried by a k-d tree
in-process.** `scripts/build-geo-index.mjs` turns the `cities1000` dump plus the
admin1 and country tables into `apps/worker/data/places.bin.gz` (~3 MB, 161k
settlements). `services/geocode.ts` memory-maps it into typed arrays at first
use and answers with `kdbush` + exact haversine. One new dependency, `kdbush`
(ISC, 6 KB), bundled into `dist/` via tsup's `noExternal` so the lookup does not
depend on how `node_modules` is laid out in the image.

Four rules do the real work:

**1. Places have size.** Nearest-centroid-wins answers the wrong question:
standing in central Kyiv, the closest point is whichever suburb's centroid
happens to sit nearby. Each place instead gets an effective radius growing with
the square root of its population (settled area scales roughly with people), and
candidates compete on `distance / radius`. Kyiv reaches ~14.5 km, which holds
Troieshchyna; a 1 500-person town reaches ~1.1 km, so standing in that town
still names the town.

**2. Out past that radius, only the region is claimed.** A shot 11 km up a
Carpathian valley is labelled `Zakarpattia, Ukraine`, not the nearest village.
Two kilometres outside Khotiv is `Kyiv Oblast, Ukraine` — not Khotiv, and not
Kyiv. The label carries a `precision` of `place` or `region` to say which.

**3. Nothing at all beyond 25 km.** Deliberately tighter than the 50 km first
tried, because at 50 km both Pripyat and Chornobyl collapse into Slavutych —
one label for three very different places, flowing straight into an AI caption.
Wilderness gets no label: Yellowstone, the Sahara and the open ocean all return
null.

**4. Coordinates are validated, never coerced.** `typeof x === "number"` and a
finite range check, not `Number(x)` — because `Number(null) === 0`, and the
schema permits a row with a latitude and no longitude (`exif.ts` fills the two
axes independently, and there is no both-or-neither constraint). Such a row used
to be representable as a confident, entirely fictional place on the Greenwich
meridian. `(0, 0)` is likewise rejected: it is a real spot in the Gulf of
Guinea, but in EXIF it is overwhelmingly a zeroed field.

Everything is written to degrade rather than fail. A missing, truncated,
corrupt or wrong-version data file logs once and disables labelling; it never
takes down ingest, analyze or caption. `""` in `gps_label` means "we looked and
found nothing", which is what stops the backfill from re-examining every
wilderness shot forever.

**Backfill**, not a migration: coordinates are already stored, so labelling the
existing archive is a pure re-derivation over rows we have. `geo-backfill.ts`
runs on boot and every 6 h beside the retention sweeper, in batches of 500, and
settles into a no-op once every row is labelled.

## Consequences

The labels are English (`Odesa, Ukraine`). GeoNames' Cyrillic alternate names
cover only ~10% of the world's settlements — 99% of Ukraine but ~0% of most
countries — so shipping them would buy an inconsistent feature and a schema
change. A Ukrainian-language search for `Одеса` therefore does not match today.
The fix is cheap and belongs elsewhere: teach `SEARCH_PARSE_PROMPT` to emit
place terms transliterated as well as verbatim, so the Gemini query parser hands
`search_assets()` a term its ILIKE can find.

Coverage is honest rather than total. Roughly two thirds of real photo
locations get a label; the rest are genuinely far from any settlement in the
dataset, and are left blank rather than approximated. Population-1000 is the
floor, so hamlets below it resolve to their region.

We now ship a 3 MB binary in the repository and own its refresh. The build
script pins the sha256 of every input into the artifact header and orders rows
by numeric geonameid — not `localeCompare`, whose result depends on the build
machine's ICU locale — so a rebuild that differs byte-for-byte means the data
changed, not the machine. Refreshing is a manual, roughly annual job.

GeoNames is CC BY 4.0. `apps/worker/data/NOTICE` records the obligation, but a
server-side file does not discharge it: the derived labels are user-facing, in
search results, captions and exports, so the credit has to appear in the product
too.

Two follow-ups fall out of this and are tracked separately: a
`check ((gps_lat is null) = (gps_lon is null))` constraint on `asset_exif`, so
the half-populated row this ADR defends against becomes unrepresentable rather
than merely handled; and the Cyrillic place-term change above.
