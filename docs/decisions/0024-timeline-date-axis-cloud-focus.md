# 0024. Timeline is a horizontal date axis; clouds gain focus and whole-cloud drag

Date: 2026-07-21 (authored on GG's design branch `feat/timeline-date-axis-cloud-focus`;
integrated by cherry-pick — the branch was stacked on the pre-#93 design base, so
only its own delta landed, adapted to the tag-driven lines of
[0022](0022-timeline-clouds-and-live-cloud-labels.md) and the derived topics of
[0023](0023-topic-clouds-derived-from-tags.md))

Status: Accepted

Supersedes the Timeline part of [0022](0022-timeline-clouds-and-live-cloud-labels.md)
(Timeline as a month-bucketed freeform cloud). The Map/Topic cloud canvas, the
glide animation, the live labels/backdrops and the tag-driven connecting lines
from 0022/0023 are unchanged.

## Context

0022 made Timeline the same freeform cloud canvas as Map/Topic, bucketed by
capture month. That deliberately traded away the strict left-to-right
chronological reading ("the accepted cost of all views are the same canvas").
In practice the trade read as a loss: a timeline whose months float as blobs
does not communicate *time*. GG's next design iteration restores a real time
axis while keeping the unified-canvas mechanics (same tiles, same drag paths,
same glide).

## Decision

- **Timeline = `timelineAxisLayout`** (`lib/layout.ts`), replacing
  `timelineCloudLayout`: every distinct capture **day** (`YYYY-MM-DD` from
  `exif.dateTaken`) is a fixed, **evenly-spaced column** — equal gaps between
  date labels regardless of the real time between them — labeled `DD/MM/YYYY`
  on a horizontal axis line with a colored tick per date.
- **Files fill a grid centered on their date, split above and below the axis**
  (odd counts put the extra tile above), so a busy day grows symmetrically and
  even hundreds of files stay in their day's column. Within a day files order
  chronologically (stable hash tie-break — deterministic, SSR-safe).
- **Drag is clamped to the date column**: a tile's override x is clamped into
  its own day's ± half-gap range (y stays free) — files can never visually
  cross onto another date. The colored day cloud is a stronger **band pinned
  to the date column** (not the drifting tile bbox), so the column reads as
  the unit.
- **No connecting lines on Timeline** — the axis and per-day bands carry the
  structure; the shared-tag web (0022) stays on Map/Topic. `CloudLayout` gains
  an optional `axis` field only Timeline sets.
- **Cloud focus (all grouping views):** clicking a cloud's label focuses that
  cloud — other clouds' backdrops, tiles and labels fade to 22%, while their
  *lines* fade only halfway (50%) so cross-cloud links stay readable. Clicking
  the label again, clicking empty canvas, or switching views clears focus.
  Implemented via `CloudLayout.tileCloud` (tile → cloud) and a `cloudKey` on
  same-cloud edges; focus state is UI-only (`focusedCloudKey`), never
  persisted.
- **Whole-cloud drag:** dragging a cloud's label moves every tile of that
  cloud together (one history entry, one override write per tile into the
  active view's bucket). A click without movement is what focuses; >3px of
  movement is a drag.
- **Icon refresh:** AI assistant → sparkle, Pan → 4-way move, from the design
  system's line/fill set.

## Consequences

- Timeline finally reads as time again — 0022's "accepted cost" is paid back —
  while staying the same persistent-tile canvas (tiles still glide when
  switching views).
- Day-level bucketing means a no-EXIF file falls to its `created_at` day, and
  malformed dates land on the epoch day (1970) — visible at the far left, an
  honest signal rather than a hidden bug (same `capturedAt` fallback as 0016).
- Timeline drag overrides persist per project (0022's store) but are now
  clamped on read — stale coordinates from the cloud era can shift a tile
  within its day, never across days.
- The Timeline no longer participates in the tag web; if per-day tag relations
  prove useful later, edges could return scoped within a day's column without
  breaking the axis reading.
- `timelineCloudLayout`, `monthOf` and the month helpers are gone; Timeline no
  longer passes `frames` (no lines to detach — frames still draw and tiles can
  still be dropped on them, it just has no web to leave).
