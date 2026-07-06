# 0006. Full replace with the v2 redesign, not an incremental reskin

Date: 2026-07-05

Status: Accepted

## Context

The user supplied an updated Claude Design handoff bundle containing a new
`.dc.html` mockup (archived at `docs/design/ArchiveMind-v2.dc.html`) that
turned out to be a substantially different, simpler redesign rather than an
incremental update to the v1 app: new theme (Inter font, purple/indigo pill
UI vs. v1's Space Mono terminal-green sharp-cornered UI), a single hardcoded
archive instead of multi-project switching, no source integration
(Google Drive/iCloud/Dropbox as a data concept), no AI Chat panel, no Help
modal, no Account dropdown menu — even the new mockup's own rail icons for
"Chat"/"Help"/"Library"/"AI Agents"/"Tags"/"History" are wired to no-ops in
the source itself, confirming these are deliberately decorative, not an
oversight to "finish." The user explicitly confirmed: full replace, match the
new design exactly.

## Decision

Replaced rather than reskinned. Concretely:

- **Data model**: dropped `Photo.source`/`Photo.project` entirely; reduced
  `PhotoGroup` from 8 values to 4; reduced the mock archive from 235 photos
  (40 hand-authored + 195 synthetic) to 12 hand-authored photos only — the
  new mockup has no synthetic bulk-generation code at all.
- **Views**: renamed `neural|timeline|map|sense` → `canvas|timeline|map|smart`.
  The Neural hub→folder→file hierarchy is gone; `canvas` is now a flat
  free-form view where photos sit at their own `x`/`y` and are directly
  drag-repositionable. Map view no longer uses Leaflet — it draws 8
  hand-coded inline SVG country polygons (`lib/layout.ts`'s `LANDS`
  constant) instead of a real basemap; the `leaflet`/`@types/leaflet`
  dependency was removed. `lib/layout.ts`'s old hash-based
  (`hash()`/DJB2) placement — used for Neural's folder bucketing, Timeline's
  month scatter, and Sense's circle-packing — is gone entirely and was
  removed as dead code; the new `computeLayout(view, photos)` uses real
  time-sorting for Timeline and fixed hub/country coordinates for
  Smart/Map, no hashing needed anywhere.
- **CSS variables were fully renamed** to match the new mockup exactly
  (`--bg` → `--bg-canvas`, `--ac` → `--accent-green`, etc.), not kept under
  the old names with remapped values. This invokes
  [0001](0001-inline-styles-over-tailwind.md)'s own exit clause ("revisit
  this decision only if we deliberately redesign a screen") — every
  component's inline styles were being touched anyway for the
  pill-radius/spacing changes, and the old→new variable sets aren't 1:1
  (new adds `--bg-card`/`--accent-indigo` with no old equivalent; old had
  `--t2b`, an accessibility-contrast fix, with no new equivalent). Keeping
  stale names pointing at new colors would be a permanent, avoidable
  footgun for the next reader.
- **Removed UI surfaces**: AI Chat panel, Help modal, Account dropdown,
  Project dropdown/switcher, "Add to Project" popover, the collapsible left
  sidebar (replaced by a fixed 60px icon rail), and the click-to-expand
  preview modal for map/smart clusters (the new mockup's map/smart photos
  are always directly interactive, no separate zoomed-in preview state).
- **New/changed behavior** (not just visual — verified against the mockup's
  script, not just its markup):
  - Bulk AI panel now shows in **every** view when something's selected, not
    gated to Timeline.
  - `runBulk` gained a real guard: if all 4 ops (captions/tags/**timeline**/faces)
    are unchecked, it toasts "Select an operation to run" and aborts — a new
    "Build timeline" op was added alongside the existing three.
  - Selection clears on view switch **except** when returning to/staying on
    `canvas` (asymmetric, not a blanket clear).
  - Dragging an already-selected photo in `canvas` view now moves the whole
    selection together, not just the dragged tile.
  - `selectedIds` defaults to `['e','g','j']` on load — a non-empty demo
    default, not `[]`.
  - Added a bookmark toggle (UI-only state, not a `Photo` field) and a
    bottom caption-chip pill on wide-enough processed tiles.

## Consequences

This is a large, mostly one-way diff — a lot of v1's UI surface (chat, help,
account menu, multi-project data model, Leaflet map) is gone, and reverting
to v1 behavior would mean redoing this ADR's decision, not just editing a
few components. The [0002](0002-data-access-seam.md) data-access seam and
[0004](0004-single-workspace-hook-no-state-library.md) single-hook state
approach were both kept intact — only their *contents* changed, not the
architectural pattern.

[0005](0005-functional-project-filtering.md) is superseded: there is no
project concept left to filter by.

## Preserved quirks (v2)

Per [0003](0003-preserve-source-quirks.md)'s spirit — documented rather than
silently "fixed":

- Bulk AI ops (captions language/style, tags, faces, **timeline**) remain
  cosmetically wired but functionally identical output from `finishBulk` —
  which op is checked doesn't change what happens, only *whether* `runBulk`
  proceeds at all now requires at least one checked.
- Caption styles Agency/Archival still render identically; only Social
  differs (truncates + hashtags).
- The EXIF block is still static/identical across every photo.
- The photo drawer's prev/next still cycles the full unfiltered photo array
  (now just 12 photos — there's no project to filter by anymore).
- Photos uploaded via the Add/Import flow get a `group` assigned round-robin
  but never a `country` (`country: ""`) — the Map view's
  fallback-to-`"Ukraine"` grouping silently covers this, matching the source
  mockup's own `doUpload` exactly.
