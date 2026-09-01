# 0040 — Colour labels are a second axis beside the AI one, not more tags

## Status

Accepted — 2026-08-08.

## Context

Everything the canvas currently groups by is derived from the file: capture date
(Timeline, ADR 0024), EXIF GPS (Map, ADR 0027), the model's own reading of the
image (Topic, ADR 0028/0038). The archive had no way to record a *decision*.
"Keep this one", "reject that one", "these go to the client" is the first pass a
photographer makes over a shoot, and it happens before — and often instead of —
anything an AI can say about the frames.

macOS Finder's coloured tags are the reference implementation people already
have in their hands, and Lightroom/Capture One/Bridge have taught the same
gesture to exactly this audience. The request was for that, plus sorting and
grouping on top of it.

Three questions had to be answered before writing any of it.

**Where does a label live?** The tempting answer is the existing `tags` table —
it is right there, it is per workspace, it already joins to assets. It is also
load bearing three separate times: Topic falls back to a tag heuristic for
unclustered assets (ADR 0023), the connecting-line web between tiles IS shared
tags (ADR 0022), and `search_assets()` ranks a tag hit into the explicit tier
(ADR 0029/0031). A row named `red` in there would grow a "red" cloud on Topic,
wire every marked photo to every other marked photo, and surface on a text
search for the colour. The two things also have different authors: the analyze
handler writes tags, and only a human writes a label.

**One label per photo, or several?** Finder allows several. A packed cloud
canvas cannot: a tile is one object at one position in one cloud, so the LABELS
view has to be able to ask a photo for *the* colour it groups under. Finder
dodges this because a list row can carry three dots and still sort by the first.

**What does filtering mean on an infinite canvas?** In Finder, filtering
re-flows the grid, because the grid is disposable. Here the arrangement is the
user's work — dragged tiles, artboards, folders — and it is what an export reads
(ADR 0035 exports the canvas reading order).

## Decision

**A colour label is a single-valued column on `assets`, not a tag.**
`assets.label` is a nullable `asset_label` enum carrying the seven macOS
colours in macOS order. Migration `20260808000001`. No new RLS policy: the
existing `assets_update` (`is_editor`) already covers it, which is the same gate
the soft delete runs through.

**The seven names are renameable per workspace.** `workspace_labels
(workspace_id, label, name)`, one row per *renamed* colour only — the defaults
live in `packages/shared` and need no seeding, so every workspace that predates
the migration is already correct with zero rows. A colour means nothing until it
carries the user's own word ("Rejected", "Client picks"). This mirrors the Topic
cloud rename (ADR 0038); there is no `is_renamed` flag because the row's
existence is the flag — nothing regenerates these names.

**Assigning is the same swatch row everywhere**: the top of the right-click menu
(where Finder puts it), the Workspace action bar, the drawer, and the number
keys `1`–`7` with `0` to clear. Bare digits, not `⌘1`–`⌘7`, because that
combination switches browser tabs; Lightroom uses bare digits for the same job.
Every path funnels through one bulk route, `POST /api/assets/label`, and the
write is optimistic with an Undo toast that restores each photo's *previous*
colour rather than clearing it.

**The filter hides tiles; it never moves them.** Every layout still runs over
the full photo set, and the filter is applied at one seam
(`visibleTilePositions`) that strips the hidden tiles' positions. A marquee
cannot grab what it cannot see, the minimap stops plotting it, and Fit frames
what is on screen — while artboard membership, folder contents, frame counts and
exports keep seeing the real geometry. Clearing the filter puts everything back
exactly where it was. The filter is per session and never persisted: a saved
filter is a canvas that looks empty for reasons the next visit cannot explain.

**Grouping is a fifth view, `LABELS`.** It reuses `buildCloudLayout` — the same
generic Topic and the old Map clouds are built from — with the colour as both
the cloud key and the staleness anchor, so ADR 0038's mechanic comes for free: a
tile dragged and then re-coloured re-packs into its new cloud instead of
stranding itself (and its old cloud's label) across the canvas. Two departures
from Topic: no connecting lines, because a colour is a human statement and a tag
web over it would assert an AI relation the user never made; and a `No label`
cloud, because "what have I not triaged yet" is the question this view exists to
answer.

**Zero credits.** No model runs, so `POST /api/assets/label` writes no
`usage_events` row (ADR 0037: a credit is one AI action on one photo).

## Consequences

- The word "tag" now unambiguously means AI output in this codebase, and
  "label" means human curation. `topic_clusters.label` predates both and is a
  third thing (a cloud's display name); it keeps its name.
- Multi-label is not foreclosed. It becomes an `asset_labels` join table and a
  rule for which colour a tile groups under; nothing here has to be undone.
- The canvas read (`getRealPhotos`) now selects a column that a database without
  the migration does not have, and web deploys are not transactional with
  migration pushes. It retries once without `label` on `42703` rather than
  taking the whole archive down over a colour dot; the write route fails loudly
  instead, because a dot that never persists is worse than no dot.
- `CloudLabels` now takes `onRenameCloud(cloud, name)` + `canRenameCloud(cloud)`
  instead of a cluster-id-shaped callback: two views rename a cloud and a rename
  means a different thing in each.
- A filter can hide the whole canvas. That state has its own empty message and a
  Clear filter button — an archive that looks like it lost its contents is a
  support ticket, not a feature.
- Applying a filter narrows the current selection to what survives it. Without
  that, "Move 40 to Trash" would act on photos nobody could see.

## Amendment (2026-08-12) — the LABELS view is retired

The colour-label *sorting view* is gone. `ViewMode` drops `"labels"`, and with it
`labelCloudLayout`, `labelAnchorOf`, the `label` override bucket, `labelAnchorsFor`
and `isLabelsView`. The label itself, the filter, and the swatch pickers are
untouched — this retires one way of *looking* at the axis, not the axis.

Why: a view is the most expensive surface in this UI. The other three each answer
a question the tiles cannot answer on their own — when was this taken, where, what
is in it. A colour label answers none of those, because the colour is already
drawn on every tile in every view. Grouping by it bought a count and a spatial
sense of the pile, and cost a permanent tab, a layout, an override bucket and a
staleness rule.

Consequences worth stating plainly:

- **Arrangements made in LABELS are dropped.** They lived in
  `galleryOverrides.label` in `localStorage`; removing the field means the next
  save no longer writes it. No store-version bump — the stale key is simply
  ignored, exactly as an unknown key always was. Nothing on the server moved.
- **`CloudLabels`' rename callbacks stay pair-shaped** (`onRenameCloud(cloud, name)`
  + `canRenameCloud(cloud)`) even though Topic is now their only caller. The pair
  is the honest signature — a cloud key is not a cluster id — and reverting it to
  a cluster-id callback would have to be undone by the next view that names clouds.
- **Renaming a colour has no entry point any more.** It had two: the filter
  panel's name, and a LABELS cloud's name. This is deliberate, not an oversight:
  the seven defaults are colours, and a workspace that wants "Rejected" instead of
  "Red" is a real want but not one worth a surface of its own right now.
  `workspace_labels`, `PATCH /api/labels`, `renameLabelRequestSchema` and
  `resolveLabelNames` are all kept and still work — `LabelNames` is threaded to
  every swatch row for tooltips regardless, so the reader cost is zero and the
  route is one component away from being reachable again.

## Amendment (2026-08-12) — the filter moves onto the bottom bars

`LabelFilterPanel` and the left rail's Labels button are gone. The colour control
is now one object, `LabelBarControl`, on both bottom bars, and it is
**context-sensitive**: with a selection the swatch row marks it (unchanged), with
nothing selected it filters the canvas.

The two jobs never overlap, which is what makes one control honest — an empty
selection is exactly when "mark the selection" has nothing to do. Before this,
the one axis was operated from opposite edges of the screen: marking on the
bottom bar, filtering on the left rail.

- `toggleLabelMenu` no longer refuses on an empty selection. That refusal was
  right when the row only marked and is wrong now.
- **The filter is reachable in all-files.** `SortingActionBar` shows wherever
  `WorkspaceActionBar` does not — the sorting views *and* the all-files grid,
  where it carries the colour control and nothing else (no override bucket to
  Regroup, no clusters to re-cluster). The untriaged pile is usually what you
  open all-files to find, so that is the one place the filter must not be
  missing.
- **`LabelSwatchRow` gains `none`** — a hollow dashed ring for "photos with no
  colour at all". It is not the ✕: the ✕ clears the filter and shows everything,
  the ring narrows to the unmarked. Collapsing them would make `LabelFilter`'s
  `"none"` unreachable and the untriaged pile impossible to look at. The ✕'s
  disabled state keys on "no colour ringed **and** the untriaged filter off",
  because otherwise the only way back to the full canvas greys itself out.
- **Lost with the panel: the per-colour counts.** The strip showed how many
  photos carried each colour; the swatch row does not. Accepted — `labelCounts`
  is deleted rather than left dangling, and it is a pure function of the loaded
  photos if a future surface wants it back.


## Amendment — 2026-09-01: the Map shows the colour it was already filtering by

The amendment above retires the LABELS view on the grounds that "a colour is a
marker you read on every tile in every view". Map was the exception that made
that sentence untrue: `SortingActionBar` renders there, so you could *filter* the
map by a colour, and the markers themselves never carried one. A photo marked
red on the canvas lost its mark the moment it appeared on the map.

**The dot is drawn per marker CELL, not per marker.** A cluster tiles up to four
photos (ADR 0027's mosaic amendment), and a colour label belongs to a photo — so
each tile of the mosaic carries its own dot or none, exactly as each canvas tile
does. The alternative, summarising a cluster's colours into one row of dots, was
rejected because the marker only carries the four photos it draws: a summary
would silently describe those four while looking like it described the hundreds
behind them.

Placement differs from the canvas tile out of necessity rather than taste. On a
tile the dot sits beside the filename, on the tile's own chrome; a map marker has
no chrome, so the dot goes **on the photograph**, top-left inside its cell —
the one corner nothing else uses, since the count badge hangs outside the
opposite one. A 1.5 px dark ring is what keeps a yellow dot on a bright sky
readable; without it the swatch washes out at exactly the size it is least
recoverable.

`GeoPoint.label` is non-optional (`AssetLabel | null`) rather than `label?:`,
so a reader of the map's data cannot forget the field exists — which is how it
went missing in the first place. `coverThumbs` becomes `coverCells`: the marker
needed a second per-photo fact, and a parallel array of labels beside the
thumbnails is the shape that drifts.

The workspace's renamed colour names reach the marker (`labelNames` through
`GeoMapPane`), so a dot's tooltip reads "Client picks" wherever the canvas says
so rather than "red". The filter needed no work — `GeoMapPane` already receives
`ws.visiblePhotos`, which is label-filtered.
