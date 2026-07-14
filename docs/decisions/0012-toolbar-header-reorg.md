# 0012. Left sidebar removed; its actions move to the header and bottom toolbar

Date: 2026-07-07

Status: Superseded in part by [0014](0014-project-first-navigation.md), and its
Map/Leaflet prose by [0016](0016-real-timeline-topic-map-views.md)→[0018](0018-cloud-clusters-map-topic-default-zoom.md)
— the Leaflet geo map and `components/map/` described below no longer exist.

## Context

The user supplied an updated Claude Design handoff (`ArchiveMind.dc.html`)
that evolves the existing v1 mockup — same Space Mono/terminal-green theme,
same `neural | timeline | map | sense` views, same multi-project model — not
the "v2" full-replace redesign that was tried and reverted the day before
(#1). The new mockup drops the collapsible left rail entirely: Search,
AI Chat, and Extract EXIF move into the bottom toolbar (alongside a new
"Generate Captions" bulk-AI toggle and a new Frame tool); Logs, Help, and
Privacy Policy move into a new header utility-button row. The header's
single project-dropdown button becomes a two-part breadcrumb ("All my
files" root + "/" + project name), gains Undo/Redo, and the zoom% control
becomes a dropdown with presets. A minimap (orientation aid) and undo/redo
history (over frame/node/timeline/expand-file positions) are also new.

The sidebar's decorative "Auto-Tag" button (already a no-op per
[0003](0003-preserve-source-quirks.md)) has no direct replacement — the new
"Generate Captions" toggle is the real functional equivalent, wired to the
bulk-AI panel instead.

## Decision

- Deleted `components/sidebar/LeftSidebar.tsx`.
- `components/header/AppHeader.tsx` gained the crumb split, undo/redo
  buttons, a zoom-dropdown trigger (new `components/header/ZoomDropdown.tsx`),
  and the Logs/Help/Privacy utility row (same icons and `.tw`/`.tip` tooltip
  pattern the sidebar used).
- `components/toolbar/BottomToolbar.tsx` gained a Frame tool button and the
  four relocated actions (Search, Chat, Generate Captions, Extract EXIF).
  Its previous `showCanvasTools` gate (hid Select/Hand/Fit/Zoom in
  Map/Timeline views) was dropped to match the source, which renders these
  unconditionally — Select/Hand/Frame are visible-but-inert in Map view,
  consistent with other cosmetic-but-wired controls already documented in
  0003. Fit/Zoom are properly Map-aware now (see below), so they're no
  longer dead buttons there.
- New `components/canvas/FrameOverlay.tsx` (Figma-style draggable regions)
  and `components/toolbar/Minimap.tsx`.
- `hooks/useWorkspace.ts` gained frame state, undo/redo history
  (`{frames, nodeOverrides, tlOverrides, expandOverrides, photos}`
  snapshots, capped at 50), and `bulkPanelOpen` — the bulk-AI panel is now
  gated on an explicit toolbar toggle plus a selection, not on
  `isTimelineView` (it can open in any view now).
- `components/map/MapCanvas.tsx` now exposes a small imperative API
  (`fitWorld`/`setZoomPct`/`getZoomPct`) via an `onMapReady` callback, and
  reports zoom changes via `onZoomChange`, so the header zoom dropdown and
  toolbar Fit/Zoom buttons work correctly against the real Leaflet instance
  while in Map view — previously these were silently inert there.
- **Chat panel moved from left-anchored (next to the sidebar) to
  right-anchored** (`right: 0`, matching the source). This was necessary,
  not just a style tweak: the source's Photo Drawer shifts left by 320px
  when chat is open so the two can be open simultaneously without
  overlapping (`components/drawer/PhotoDrawer.tsx`'s new `right` prop) —
  that only makes sense if chat sits on the same edge the drawer does.

## Consequences

This is a real layout deviation from the previous frontend, but it's
sourced directly from the new mockup, not a stylistic choice — every
button that existed in the sidebar still exists, just relocated. Losing
the sidebar's photo-count display has no replacement; the new mockup
doesn't show one anywhere. [0005](0005-functional-project-filtering.md)
and [0002](0002-data-access-seam.md) are unaffected — no data-model or
`lib/api.ts` seam changes were needed.
