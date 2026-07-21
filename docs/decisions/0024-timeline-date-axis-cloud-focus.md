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
  even hundreds of files stay in their day's column. Partial rows re-center on
  the date (a 1-file day sits exactly under its tick, not left-filled into a
  3-slot grid). Within a day files order chronologically (stable hash
  tie-break — deterministic, SSR-safe).
- **Drag is clamped to the date column**: a tile's override x is clamped into
  its own day's ± half-gap range (y stays free) — files can never visually
  cross onto another date. The colored day cloud is a stronger **band pinned
  to the date column** (not the drifting tile bbox), so the column reads as
  the unit.
- **No connecting lines on Timeline** — the axis and per-day bands carry the
  structure; the shared-tag web (0022) stays on Map/Topic. `CloudLayout` gains
  an optional `axis` field only Timeline sets.
- **Cloud focus (all grouping views):** clicking a cloud's label focuses that
  cloud — other clouds' backdrops, tiles and labels fade to 22%, while *lines*
  fade only halfway (50%) so cross-cloud links stay readable. The halfway fade
  applies to every cross-cloud bridge, including the focused cloud's own —
  bridges carry no `cloudKey`, only same-cloud lines do, and only the focused
  cloud's same-cloud lines stay at full opacity. Clicking the label again,
  clicking empty canvas, or switching views clears focus; a focus key whose
  cloud no longer exists (photo deleted, topics re-derived) reads as no focus
  rather than dimming the whole canvas. Focus state is UI-only
  (`focusedCloudKey`), never persisted.
- **Whole-cloud drag:** dragging a cloud's label moves every tile of that
  cloud together (one history entry, one override write per tile into the
  active view's bucket; the origin positions come from the exact layout the
  canvas is rendering — no recompute in the pointer-down handler). A click
  without movement is what focuses; >3px of movement is a drag. **On Timeline
  the whole-cloud drag is vertical-only** (and only vertical movement counts
  as a drag): the label, tick and band are pinned to the date column and tile
  x is clamped into it, so a horizontal component could only write raw
  overrides past the clamp — a saturating write that would permanently
  collapse the day's 3-column grid into a line once re-anchored.
- **Icon refresh:** AI assistant → sparkle, Pan → 4-way move, from the design
  system's line/fill set.

## Consequences

- Timeline finally reads as time again — 0022's "accepted cost" is paid back —
  while staying the same persistent-tile canvas (tiles still glide when
  switching views).
- Day-level bucketing means a no-EXIF file falls to its `created_at` day, and
  malformed dates land on the epoch day — *local* midnight Jan 1 1970, so the
  bucket is `1970-01-01` in every timezone — visible at the far left, an honest
  signal rather than a hidden bug. (`lib/assets.ts` also guards an unparseable
  `asset_exif.taken_at` DB value back to `created_at`, so the epoch bucket is
  reserved for truly malformed `dateTaken` strings.) The layout's bounds
  include the axis line, ticks and labels on all sides, so fit/centering keeps
  the axis with the tiles even when a day has no below-axis files.
- Timeline drag overrides persist per project (0022's store) but are now
  clamped on read — stale coordinates from the cloud era can shift a tile
  within its day, never across days.
- The Timeline no longer participates in the tag web; if per-day tag relations
  prove useful later, edges could return scoped within a day's column without
  breaking the axis reading.
- `timelineCloudLayout`, `monthOf` and the month helpers are gone; Timeline no
  longer passes `frames` (no lines to detach — frames still draw and tiles can
  still be dropped on them, it just has no web to leave).
