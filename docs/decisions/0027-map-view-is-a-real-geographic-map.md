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


## Amendment — 2026-07-27: roads are opaque, not translucent

The road overrides shipped as `rgba(255,255,255,0.055)` / `0.10` over the near-black
land. A street network crosses itself constantly, and every crossing composites the
veil a second time — so a city grid rendered as a field of bright dots at exactly
the junctions, the opposite of the quiet basemap this view is for.

The same alphas are now composited against LAND once, at build time, and shipped as
opaque `#161616` / `#212121` (`overLand()`). The design intent is unchanged; only
*when* the alpha is applied moved. `line-opacity: 1` is pinned alongside, because
upstream's `dark` style ships `"line-opacity": 0.9` on `highway_minor` — overriding
only the colour would have left exactly the compositing an opaque colour exists to
remove. Verified against `tiles.openfreemap.org/styles/dark`; no other road-ish
layer renders with upstream paint (everything else is in HIDDEN_LAYERS or
PAINT_OVERRIDES).

Net visual change away from the junctions: `highway_minor` moves from an effective
#141414 (0.055 × upstream's 0.9) to #161616 — two levels out of 255.


## Amendment — 2026-09-01: a cluster wears photographs, not a blank plate

The Decision above says a cluster marker is a photo thumbnail with two cards
peeking out behind it. On production it was a **black square with a count** —
the one marker on the map that showed no photograph at all, and the only thing
a place with more than one photo ever rendered as.

The cause is a silent supercluster contract: `map` — which projects a point's
properties onto its cluster — is only ever *called* when a `reduce` is supplied
alongside it (`if (reduce)` guards the whole path in its clustering loop). We
shipped `map: (props) => ({ thumb: props.thumb })` with no `reduce`, so no
cluster ever received a `thumb`, and `buildMarkerElement` fell through to its
`var(--bg-in)` placeholder for every one of them. Nothing failed; the option was
simply ignored. `lib/geo-cluster.test.ts` now asserts the covers arrive, because
that is exactly the kind of defect a type checker cannot see.

**A cluster now carries the three newest photos at that place**, and the marker
spends them on depth rather than density: the plate is the newest photo — the
cover, Apple Photos' own answer — and the prints behind it wear the second and
third, dimmed 55% so they read as a stack rather than competing with the cover.
A cluster of two draws one print, not two: two cards behind a pair of photos
promise a depth that isn't there. The prints also fan further out than the 2 px
sliver the blank cards used, because a sliver of a photograph is not a
photograph.

**The rejected alternative was a 2×2 mosaic of four thumbnails.** It was
prototyped and looked at: inside a 66–82 px marker each cell lands at 33–41 px,
which over a live basemap is four unreadable smudges instead of one recognisable
photograph. The whole reason markers are DOM thumbnails rather than a symbol
layer is that you should recognise a place *by its picture*; a mosaic spends
that. The count badge already answers "how many" — the marker's job is "which
place".

Clusters carry **indices** into the point array, not thumbnail URLs. A presigned
URL is ~500 bytes and the cluster tree holds a node per zoom level, so copying
URLs upward would duplicate an archive's worth of them several times over.
Indices also make the cover *meaningful*: smallest index wins, the caller hands
us newest-first, so the cover is the newest photo at that place rather than
whichever leaf supercluster's spatially-sorted tree happened to reach first.
`mergeCoverIndices` never mutates its inputs, because supercluster hands `reduce`
a **shallow** clone of a lower cluster's properties — pushing into
`accumulated.cover` would corrupt the cluster it was cloned from.

One adjacent bug goes with it: markers were reconciled by key across *index
rebuilds*, and a cluster id is stable for the same points — so a marker built
while previews were still being generated kept its blank plate forever once the
thumbnail finally landed. The live markers now record which index built them and
are rebuilt when it changes.


## Amendment — 2026-09-01 (later): the mosaic, after all

Supersedes the "rejected alternative" paragraph of the amendment above. The
cluster marker tiles **up to four photos** instead of showing one cover with
prints behind it. Everything else in that amendment stands — the `map`/`reduce`
pairing, the indices-not-URLs rule, the index-rebuild fix.

The rejection was argued on cell size, and the number it was argued against was
wrong: it assumed the marker stays 58–82 px. Growing the cluster instead
dissolves the objection — a cluster is now 72–92 px, so a 2×2 cell lands at
35–45 px rather than the 33–41 px the sketch was judged on, and at those sizes a
photograph survives. A single photo is **untouched at 52 px**: it has nothing to
divide, and the size gap now also does work, saying "many" before you read the
badge.

Two and three photos split into **rows, not columns**. A half-width cell crops a
landscape photo — which most of an archive is — down to a vertical sliver of its
middle; a half-height one keeps the frame readable. Three is the asymmetric
case: the newest photo takes the full-width top. A cluster of two tiles two
cells, never a 2×2 with holes in it (`mosaicCells`).

What the cover version bought and this spends: a stack of prints is a *stronger*
single image, and only ever showed one photograph. What the mosaic buys: a place
holding a wedding and a place holding a street both showed one photo before, and
now show what is actually there. That is the trade, and it was made
deliberately.

The plate is a grid, so it needs `box-sizing: border-box` — without it the
border pushes the cells out of the tile — and the 1 px gaps are the plate's own
`--bg-in` showing through, which is what stops two dark photographs from reading
as one. `CLUSTER_COVER_LIMIT` is 4 because that is what a 2×2 holds; it is the
same constant that bounds `mergeCoverIndices`, so widening the mosaic is one
number, not a rewrite.
