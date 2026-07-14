# 0018. Map/Topic become connected "cloud" clusters; 75% default zoom everywhere

Date: 2026-07-13

Status: Accepted

Supersedes the Map/Topic parts of [0017](0017-column-grid-map-topic-photo-delete.md)
(Timeline's column grid is unaffected and unchanged).

## Context

0017 moved Map and Topic to Timeline's column-grid layout because the
original blob-cluster design (0016) was hard to use. In practice the column
grid solved legibility but lost the sense of *grouping* — nothing visually
distinguished "this photo belongs to Ukraine" beyond which column it sat in,
and there was no way to see relationships between groups at all. A reference
mockup supplied by the user showed labeled "cloud" clusters of files with
connecting lines colored per cluster, plus a few cross-cluster links in a
blended gradient color where two clusters share something in common.

Separately: default zoom was inconsistent across views. Canvas already used
`DEFAULT_ZOOM = 0.75` for its first-mount fit; Timeline/Map/Topic (as column
grids) used a fixed 100% scale instead.

## Decision

- **Map and Topic are freeform "cloud" clusters again**, but redesigned from
  0016's version: `lib/layout.ts`'s `buildCloudLayout` packs each
  cluster's tiles around a shared hub point (`packCircles`, brought back),
  labels the cluster above its tiles with the country/topic name, and draws
  a line from every tile to its hub in that cluster's own color
  (`mkBez` bezier curves, also brought back).
- **Cross-cluster connections**: photos sharing the *other* dimension (e.g.
  same topic, different country, in Map view) get one direct line between
  a representative photo in each cluster, rendered as an SVG
  `linearGradient` blending both clusters' colors — "some files may have
  connections to files from different clouds." This is capped at one
  representative link per pair of clusters sharing a value, not a full
  pairwise mesh, to keep the picture legible rather than a tangle.
- **Unsorted cloud**: Map photos whose country isn't in the known
  lat/lon table land in an "Unsorted" cloud (`UNSORTED_CLOUD_KEY`) with no
  lines in or out — "files that have no connection to any country/topic
  form another cloud without lines between them." (Topic has no equivalent
  case today since `photo.group` is a closed enum that's always populated.)
  This is also more honest than 0016/0017's behavior of silently folding
  every unrecognized country into "Ukraine."
- **Tiles drag freely**, exactly like the Canvas asset grid — not clamped to
  a column. Mechanically this reuses the existing "gallery" drag session
  (`kind: "source" | "asset" | "map" | "topic"`) rather than inventing a new
  mode: `GalleryOverrides` gained `map`/`topic` buckets alongside
  `source`/`asset`, and `onMapAssetDown`/`onTopicAssetDown` are thin wrappers
  around the same `onGalleryAssetDown` helper `onAssetDown` now uses.
- **Default zoom is 75% everywhere.** `lib/layout.ts` exports
  `DEFAULT_ZOOM = 0.75`; Timeline's fixed fit transform uses it directly.
  Neural/Map/Topic (real content bounds) apply it as a cap via a new
  `fitCapped` helper in `useWorkspace` (extracted from the Canvas-only logic
  `tryFit` already had): fit-to-content, but never zoom in past 75% — small
  projects land at a comfortable default instead of filling the viewport at
  200–300%, while large ones still shrink further so everything stays
  visible. `computeFit`/`doFit`/view-switching now use this uniformly for
  all three bounds-based views.
- Map/Topic's sticky `ColumnHeader` row is gone (cloud labels render inline,
  per-cluster, like the reference); Timeline keeps its `ColumnHeader`
  unchanged. Map/Topic also get the Canvas-style zoom control back in the
  header (`showZoomControl` now only excludes Timeline) since they're
  bounds-fit, real-zoom views again like Canvas — not the fixed-scale
  horizontal-scroll views Timeline is.

## Consequences

- Map's country grouping is still visually a single cluster for real data
  today (all real assets default to one country) until `country` gets its
  own backend phase — same known limitation 0015/0016/0017 already flagged.
  The Unsorted-cloud mechanism means once that data is uneven or partially
  missing, it degrades gracefully instead of mislabeling everything as one
  country.
- Marquee (drag-to-select-many) still isn't wired for Map/Topic — background
  drag pans, same as it always has for every non-Canvas view. Individual
  tile drag/select (this change) and Timeline's column drag are unaffected.
