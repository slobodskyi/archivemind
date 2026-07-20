# 0022. Timeline joins Map/Topic as freeform clouds; labels + backdrops track live tile positions; lines are shared-AI-tag relations

Date: 2026-07-16 (authored on the design branch as "0020"; renumbered and
amended 2026-07-20 at merge time — 0020/0021 were taken by then, and the
connecting lines shipped tag-driven, see the amendment below)

Status: Accepted

Supersedes the Timeline parts of [0016](0016-real-timeline-topic-map-views.md)
and [0017](0017-column-grid-map-topic-photo-delete.md) (Timeline was the last
view still on a fixed column grid). Extends [0018](0018-cloud-clusters-map-topic-default-zoom.md),
which moved Map/Topic to clouds but left Timeline behind.

## Context

After 0018, the three grouping views diverged: Map and Topic were freeform
"cloud" clusters (drag anywhere, labeled, connected by lines), while Timeline
was still a fixed-width column grid with a sticky header and horizontal scroll.
That split meant two renderers (`ColumnGridView` + `ColumnHeader` vs
`CloudView`), two drag mechanics (column-clamped `tl` drag vs the free
`gallery` drag), and two fit/zoom regimes (Timeline's fixed 75% transform vs
the others' bounds-fit-with-cap).

The product intent is that Timeline / Map / Topic are just **grouping filters
over one canvas** — the same files, re-clustered by month / country / topic —
not three different canvases. A user reference mockup reinforced this: labeled
clusters with a soft colored "cloud" behind each group.

Two problems also surfaced with the existing cloud labels:

- The label was positioned above a cluster's **macro hub**, a point computed
  from the *default* packed positions and never updated for drag overrides.
  Drag the tiles away and the label stayed stranded over empty canvas.
- Nothing sat *behind* a dense group, so once a cluster held many tiles it read
  as noise rather than one group.

## Decision

- **Timeline is now a cloud view too.** `lib/layout.ts` gains
  `timelineCloudLayout`, which buckets photos by real capture month
  (`monthOf` → `"Mon YYYY"`) and feeds them through the same `buildCloudLayout`
  as Map/Topic, ordered chronologically via a new optional comparator argument.
  It drags through the shared `gallery` path: `GalleryOverrides` gained a
  `timeline` bucket.
- **The column grid is deleted.** `ColumnGridView`, `ColumnHeader`,
  `buildColumnGrid`, the old column `timelineLayout`, the
  `ColumnGridLayout`/`ColumnTilePos`/`LayoutColumn` types, the `tl` drag mode /
  `onTlDown` / `tlOverrides` / `TlBounds`, and Timeline's special-cases in
  `wheel` / `fitView` / `computeFit` / `showZoomControl` all go. Timeline is now
  a bounds-fit, real-zoom view like the others (75% cap via `fitCapped`), so
  `fitView` (whose only remaining job was Timeline's fixed transform) is gone.
- **One persistent tile set for every view — the views differ only by sort.**
  All four views (Canvas / Timeline / Map / Topic) render their photo tiles
  through the single shared `ProjectAssetView`, positioned by the active view's
  layout (`activePositions` in `useWorkspace`). Tile *sizes* are identical across
  views (all `assetTileSize`), so switching a sort changes only each tile's
  `left/top`. Because the tiles are the same DOM nodes (keyed by `photo.id`,
  never unmounted), a CSS transition makes them **glide** to their new positions
  — a `tilesAnimating` window (~470 ms after a view switch) enables the transition
  on both the tiles and the canvas transform (the viewport re-fits over the same
  window) so a sort feels like the page reflowing in place, not a page swap. The
  transition is off during drag/pan so those stay 1:1 with the pointer. The cloud
  backdrop is drawn by a separate `CloudDecor` (behind the tiles): the colored
  blobs and labels render *immediately* with the grouping so the color cloud loads
  the same instant as the sort, while only the connecting *lines* fade in once the
  reflow settles (they're drawn between final tile centers, so showing them
  mid-glide would leave lines floating to empty space). The tile-rendering
  `CloudView` is gone.
- **Cloud labels and backdrops are derived from live tile positions.**
  `CloudNode` drops `hubX/hubY/radius` (fixed) for `labelX/labelY` and
  `bx/by/bw/bh` (the cluster's live bounding box), recomputed every layout pass
  so they follow the files as they're dragged and never strand. The label is
  anchored to the **top-center of the cloud's backdrop** and rendered on top
  (`CloudLabels`) with a colored glow — attached to the colored cloud, above the
  tiles, always visible (a centroid anchor was tried first but sat hidden under
  the files).
- **Each cloud gets a blurred faded backdrop** — a radial-gradient blob in the
  cluster's color at low opacity, sized to the live bbox and rendered behind the
  lines and tiles, so a busy group still reads as one cluster.
- **Every tool works on every view.** `onCanvasDown` now gives marquee-select
  (select tool) and frame-draw on all four views — hit-testing against the active
  view's own tile positions — and only the hand tool pans on a background drag;
  "Add to project" shows whenever there's a selection in any project view. A
  tile-drag routes to the active view's override bucket via one `onTileDown`.
  Multi-select delete deletes the whole selection at once: `deletePhoto` uses a
  functional `setState` so a `forEach` over the selection composes instead of
  each object-patch clobbering the last (previously only one file left state per
  keypress).
- **Connecting lines are real shared-AI-tag relations** *(amended 2026-07-20 —
  the design branch drew a complete graph within each cluster as a placeholder
  look; by merge time the analyze pipeline was live end-to-end, so the demo
  graph never reached `main`)*. `buildCloudLayout` links two files iff they
  share at least one AI tag (`photo.tags`, written by the analyze job — spec
  §8.2). Same-cloud links draw in the cloud's color, slightly stronger the more
  tags a pair shares; cross-cloud links draw as a gradient between the two
  clouds' colors, reduced to the strongest representative link per pair of
  clouds so inter-cloud relations read as one bridge, not a tangle (this keeps
  0018's cross-cloud restraint). Unanalyzed files have no tags, hence no lines —
  the web itself shows what AI has processed and how it relates. `buildMst` is
  gone; determinism holds (no `Math.random`, insertion-ordered maps only).
- **A file on an artboard is detached from the web.** Any tile whose center lands
  inside a frame is dropped from the cluster's connecting lines (both intra- and
  cross-cluster); `buildCloudLayout` takes the current `frames` and computes the
  detached set from live tile centers.
- **Every view opens at a fixed 75% zoom.** `fitDefaultZoom` centers content at
  `DEFAULT_ZOOM` on Canvas/Timeline/Map/Topic instead of shrinking to fit, so the
  default zoom is identical across views (a large archive no longer lands at 40–60%
  on one view and 75% on another); oversized content overflows and pans. The
  initial workspace state also starts at `DEFAULT_ZOOM`, so the first paint is 75%
  even before the fit-once-on-mount centers.
- **The canvas arrangement persists per project.** Tile drags (`galleryOverrides`),
  frames and sticky notes are saved to `localStorage` (keyed by project id,
  debounced + flushed on unmount) and restored on mount, so leaving and reopening
  a project keeps everything where it was left. UI-only state — no backend/schema.
- **The minimap is derived from the rendered tiles.** `minimapPoints` reads the
  active view's `activePositions` (the exact map `ProjectAssetView` draws) plus any
  pending uploads, so the minimap dots can't drift from what's on the grid.

## Consequences

- One tile renderer (`ProjectAssetView`) + one decor layer (`CloudDecor` /
  `CloudLabels`), one drag path (`gallery`), one selection/marquee/delete path,
  and one fit regime for all four views. Undo/redo simplifies too: the `Snapshot`
  no longer carries a separate `tlOverrides` — timeline drags live in
  `galleryOverrides` like every other tile drag.
- Timeline loses its strict left-to-right chronological reading; months are now
  spatially clustered (chronological only in packing seed order, like Map's
  countries). This is the accepted cost of "all views are the same canvas."
  The month grouping itself (real EXIF capture date, ADR 0016) is unchanged.
- Background drag no longer pans in the grouping views (it marquee-selects, like
  Canvas); panning is the hand tool / scroll / minimap, as on Canvas.
- Same known data limitation as 0018 still applies to Map (`country` awaits its
  backend phase) and Topic (`group` is the inert `"archive"` default) — each
  renders one cloud on real data until those fields go real. Timeline runs on
  real per-asset capture months today, and the connecting lines run on real AI
  tags in every grouping view.
- The lines only appear after "Analyze with AI" has run — an unanalyzed archive
  shows clouds without a web. That is intentional signal, not a bug.
