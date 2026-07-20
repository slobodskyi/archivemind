# 0017. Map/Topic become column grids; delete on any view

Date: 2026-07-13

Status: Accepted · **Map/Topic parts superseded by
[0018](0018-cloud-clusters-map-topic-default-zoom.md), and the column grid itself (Timeline's
too) by [0022](0022-timeline-clouds-and-live-cloud-labels.md) — read 0022 for what ships today.**
The delete-on-any-view decision made here is unchanged and still current.

Supersedes the Map/Topic parts of [0016](0016-real-timeline-topic-map-views.md).

## Context

0016's first cut gave Map and Topic a bubble/blob-cluster look (photos packed
into a soft blurred blob per country/topic). In practice Map and Topic ended
up looking near-identical and were hard to use — no clear reading order, tiny
tiles overlapping in a dense pack, no way to scan "what's in this group."
Timeline's column layout (one fixed-width column per bucket, header labeled
with the bucket + file count, tiles packed 2-per-row against the header) had
none of these problems.

Separately: no view had a way to delete a file. It used to only be reachable
through the old Sense/Map drill-down overlay (removed in 0016), which 0016
flagged as a gap to fix properly with a real API rather than resurrect the
client-only removal that overlay used.

## Decision

- **Map and Topic now use Timeline's column-grid layout**, bucketed
  differently: Timeline by month, Map by country, Topic by `photo.group`.
  `lib/layout.ts`'s `timelineLayout`/`mapColumnLayout`/`topicColumnLayout` all
  call one shared `buildColumnGrid` helper — same packing math, just a
  different bucket-key function and column label. This replaces `topicLayout`/
  `worldMapLayout` and their cluster/blob/edge types entirely; `packCircles`,
  `mkBez`, `EdgePath`, and `hexA` are now dead and removed.
- One shared renderer, `components/canvas/ColumnGridView.tsx`, replaces the
  three separate view components (`TimelineView`, `SenseView`, `MapView`).
  Each tile is a `PhotoTile` (previously only used by the Canvas grid), so
  Timeline/Map/Topic now also get double-click-to-open-drawer, which they
  didn't have with the old raw-div Timeline rendering.
  `components/canvas/ColumnHeader.tsx` (renamed from `TimelineHeader`)
  renders all three views' sticky header row.
- Map and Topic tiles are draggable within their own column, exactly like
  Timeline tiles (`onMapTileDown`/`onTopicTileDown` mirror `onTlDown`,
  writing into their own `mapOverrides`/`topicOverrides` state — separate
  buckets from `tlOverrides` since the same photo's dragged position means
  something different in each view's column layout).
- **Delete now works from every view.** `PhotoTile` gained an `onDelete`
  prop — a small hover button, top-right of the tile — so Canvas, Timeline,
  Map, and Topic all get it for free from the one shared component.
  `deletePhoto` calls a real `DELETE /api/assets/[id]`, which sets
  `assets.status = 'deleted'` (TECH_SPEC §11's documented soft-delete; R2
  derivative purge is a background job, not this request) — not the
  client-only `state.photos` filter the old drill-down overlay used, which
  would have made a deleted file reappear on refresh.

## Consequences

- Map's per-country grouping and Topic's per-group grouping are still
  visually a no-op for real data today (one column each) until `country`/
  `group` get their own backend phase — same known limitation 0015 and 0016
  already flagged for those fields. Nothing about this change makes that
  worse or better; it only changes how the (currently single) group renders.
- Because deletion is now a real, permanent-looking action (not a mockup
  no-op), there's no confirmation step before it fires. If that turns out to
  be too easy to trigger by accident, add a confirm step — it wasn't added
  here to keep parity with how quickly you can already delete a project
  from the homepage sidebar's menu (which does confirm), since photo delete
  volume/frequency is likely higher and a per-file confirm dialog would be
  noisy. Revisit if that judgment call is wrong in practice.
