# 0016. Real-date timeline, clustered topic/map views, canvas tab

Date: 2026-07-13

Status: Accepted · **Map/Topic parts superseded by [0017](0017-column-grid-map-topic-photo-delete.md),
then by [0018](0018-cloud-clusters-map-topic-default-zoom.md); the Timeline *layout* (column
grid) superseded by [0022](0022-timeline-clouds-and-live-cloud-labels.md) — read 0022 for what
ships today.** The real-capture-date month *grouping* decided here is unchanged and still current.

## Context

The project canvas's four views (Canvas/Neural, Timeline, Map, Topic/Sense)
had three cosmetic-mockup limitations once real per-project assets replaced
mock data:

- Timeline bucketed photos into months by hashing the photo id (documented as
  an intentional preserved quirk in [0003](0003-preserve-source-quirks.md)),
  ignoring the real capture date that real assets actually carry.
- Map rendered a real Leaflet geo map, clustering photos by country onto
  literal OpenStreetMap tiles — a lot of runtime weight (a full slippy map,
  its own pan/zoom/CSS) for a product direction that wants a stylized,
  illustrative "files forming a world map" look, not a literal atlas.
- Topic (internally still `sense`/`Sense*`) showed abstract circle bubbles
  sized by topic, and only revealed real files after a double-click fanned
  them out from the bubble. Individual files, and how they relate to each
  other, weren't visible by default.
- There was no tab back to the default unsorted Canvas view once you'd
  switched away from it.

## Decision

- **Canvas tab**: `ViewTabs` gained a fourth `CANVAS` entry (`ViewCanvasIcon`)
  mapping to the existing `"neural"` view mode, alongside `TIMELINE` / `MAP`
  / `TOPIC`. View switching was already pure client state (`useWorkspace`'s
  `setView`) with no page reload — this only adds the missing entry point.
- **Timeline** (`lib/layout.ts`'s `timelineLayout`/`monthOf`) now buckets by
  the real `photo.exif.dateTaken` (`lib/assets.ts`'s `toExifData` — real EXIF
  capture time when the worker extracted one, otherwise the asset's upload
  time; never a placeholder), sorted chronologically, instead of a fixed
  hash-bucketed 6-month list. This supersedes ADR 0003's timeline-quirk
  clause specifically; 0003's other preserved quirks are unaffected.
- **Map** (`lib/layout.ts`'s `worldMapLayout`, `components/map/MapView.tsx`)
  drops Leaflet entirely. Each country's real photos cluster (via the
  existing `packCircles` relaxation) into a soft blurred blob positioned by
  an equirectangular projection of that country's centroid — reusing
  `COUNTRY_LATLON`'s lat/lon table rather than pulling in a full geo-boundary
  dataset for literal country silhouettes, which would need real polygon
  data and wouldn't read well with only a handful of photos per country.
  Map is now a plain pannable view inside the same `PanZoomCanvas` transform
  as the other three (no separate Leaflet pan/zoom bridge), so frames, sticky
  notes, the left toolbar, and the minimap now all work on Map too.
  **Known limitation**: `photo.country` is still an inert `"Ukraine"`
  constant for every real asset until its own backend phase (`lib/assets.ts`
  — same limitation ADR 0015 already flagged for `group`); every real
  project renders as a single blob today. Additional country blobs appear
  automatically once real per-asset country data lands — no further layout
  change needed.
- **Topic** (`lib/layout.ts`'s `topicLayout`, `components/canvas/SenseView.tsx`)
  now always renders every photo as an individual tile, macro-clustered by
  `photo.group` (packed via the same `packCircles` relaxation used for the
  old bubbles), each tile connected to its cluster's centroid by a topic
  colored line, with a soft blurred background blob per cluster. This
  replaces the double-click-to-expand bubble interaction; there is no longer
  a two-step reveal.
- Map and Topic tiles select on click (same additive/shift-click semantics as
  the Canvas view) but do not support drag: repositioning a tile would fight
  the cluster it was deterministically placed into by the same layout run.
  This also removes the one-off hover "open/delete" toolbar that only
  existed on the old bubble/marker drill-down overlay — no other view (Canvas,
  Timeline) exposes an inline per-tile delete button, so this isn't a
  regression against an established pattern, just a dropped inconsistency.
- Removed with the old interaction model: `ExpandFileTile`, `fanOut`,
  `senseExpandLayout`, `mapExpandLayout`, `ExpandOverlay`/`ExpandFile` types,
  `SenseBubble`/`senseBubbles`, the `expanded`/`expandOverrides` workspace
  state, and the `leaflet`/`@types/leaflet` dependencies (including their
  `globals.css` imports/overrides).

## Consequences

- Timeline is meaningful for real archives immediately; no backend work
  needed since capture date was already flowing through.
- Map's per-country grouping is currently a no-op visually (one blob) until
  `group`/`country` get their real backend phase (tracked separately, see
  ADR 0015's equivalent note for `group`) — this is a known, temporary gap,
  not a bug to "fix" by inventing country data client-side.
- Deleting a photo from the canvas has no UI entry point at all now (it
  previously only existed on the removed drill-down overlay). Re-adding
  photo deletion is out of scope here — track it as its own feature with a
  real API call, not a client-only `state.photos` filter.
