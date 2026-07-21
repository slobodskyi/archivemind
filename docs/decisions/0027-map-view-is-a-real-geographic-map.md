# 0027. The Map view becomes a real geographic map

Date: 2026-07-21

Status: Accepted (supersedes the Map half of 0016, 0017, 0018; Timeline and Topic keep theirs)

## Context

Map has never been a map. ADR 0016 removed Leaflet and drew countries as soft
blobs; 0017 made them a column grid; 0018 made them packed clouds. All three
clustered on `photo.country`, which `lib/assets.ts` fills with a hardcoded
`"Ukraine"` for every real asset. On real data the view therefore rendered
exactly one cloud labelled Ukraine — documented in 0018 as "the data, not a
bug", pending "its own backend phase".

That phase is ADR 0026: `asset_exif.gps_lat/gps_lon` have always been
populated, and the worker now derives a place label from them. The backend owns
the field. Meanwhile PLAN.md has carried the note "the Leaflet geo map is
removed … revisit a real map later if wanted" since 0016.

The reference point is Apple Photos' Places, which the user asked for by name.
Six mechanics do the work there: one cluster tree tied to zoom, so panning and
zooming split and merge stacks continuously; markers that are *thumbnails*, so
you recognise a place by its photograph; tap-a-cluster-to-zoom-into-it as the
primary navigation; a muted basemap so the photos are the brightest thing on
screen; a tap-through to the photos at one spot; and only geotagged photos
participating at all.

## Decision

**The `map` ViewMode renders MapLibre GL over OpenStreetMap vector tiles, with
supercluster over each photo's EXIF coordinates.** Canvas, Timeline and Topic
are untouched.

**Basemap: OpenFreeMap's `dark` style**, recoloured onto our tokens in
`lib/map-style.ts` — land to `--bg`, water one step above it, boundaries to our
hairline alphas, place labels onto the grey text ramp, and twenty layers of
roads, rails, runways, footpaths and water names removed outright. Free, keyless,
uncapped, self-hostable later if we ever want the traffic off someone else's
servers. The recolour is applied to the fetched style JSON *before* the map is
constructed; doing it on the `load` event shows one frame of the stock style
first.

Space Mono is not available: OpenFreeMap serves exactly three fontstacks (Noto
Sans Regular, Bold, Italic) and naming an unavailable font in `text-font` drops
the labels entirely rather than falling back. Wide tracking and uppercase carry
our typographic voice instead. Real Space Mono would mean self-hosting a glyph
endpoint — possible later, and out of scope here.

**Markers are DOM elements, not a symbol layer**, because each is a photo
thumbnail wearing our tile chrome: `--bg-in` plate, 1 px `--bd` hairline, radius
3, and a rotated-square tail whose two visible edges are that same hairline.
Clusters add two cards peeking out behind the plate — a stack of prints — and a
count badge with thin-space thousands (`27 027`). Unlike the canvas tiles they
carry a resting shadow: they float over a live basemap and have to detach from
it. At the counts clustering produces — tens on screen, never thousands — DOM is
both cheaper to reason about and far more controllable than a symbol layer.

**Clicking a cluster zooms to its expansion zoom**, Apple's core gesture. A
cluster that cannot be split — every photo at one coordinate, or already at max
zoom — opens a panel of its photos instead of silently swallowing the click.
That panel is deliberately the same shape as the chat panel's search-result
strip: same 38 px thumbs, same "select on canvas" hand-off, so the two read as
one idea rather than two.

**Only geotagged photos appear, and the view says so.** A chip reads "N of M
files have no location". Without it, an archive of messenger-stripped photos
looks simply broken; with it, the absence is information. Exactly `0,0` is
excluded — it is a real spot in the Gulf of Guinea but overwhelmingly a zeroed
EXIF field, and plotting it would put a phantom cluster there.

The dead cloud path is removed, not left alongside: `mapCloudLayout`,
`mapCloudColor` and the `COUNTRY_LATLON` import go, and the tests that used
`mapCloudLayout` to exercise shared `buildCloudLayout` behaviour are retargeted
onto `topicCloudLayout`, which still has clouds.

## Consequences

Map is the one view that is not a sort of the canvas tiles. It does not
participate in ADR 0022's glide, cloud focus, whole-cloud drag or artboards, and
the shared `activePositions`/`cloudDecor` machinery skips it — it covers the
canvas rather than reflowing it. That is a real inconsistency in the four-view
model, accepted because a map that pretends to be a cloud sort is what we just
spent three ADRs discovering does not work. Apple's map behaves the same way:
nothing glides between the grid and the map.

~290 KB gzip of MapLibre and supercluster enter the bundle, loaded only when the
tab is opened — `next/dynamic` with `ssr: false`, which in Next 16 is legal only
inside a Client Component, hence the `GeoMapPane` / `GeoMapCanvas` split.
MapLibre reads `window` at import time and can never be prerendered.

The basemap is a third-party runtime dependency. If OpenFreeMap is unreachable
the view renders a "Map unavailable" state rather than a blank pane; the rest of
the app is unaffected. Tile requests reveal *viewport* coordinates to
OpenFreeMap — not which photos are where, and no photo data — but it is a new
egress that did not exist before, and worth knowing for an archive whose
locations can be sensitive. Self-hosting tiles removes it.

Attribution is now a product-level obligation, discharged in the map chrome:
OpenStreetMap and OpenFreeMap through MapLibre's own attribution control, and
GeoNames — which ADR 0026 could only record in a server-side NOTICE — alongside
them.

`photo.country` is now unused by any view; it survives only in the source
browser's search haystack and its inert `"Ukraine"` default in `lib/assets.ts`.
Removing the field is a separate cleanup.
