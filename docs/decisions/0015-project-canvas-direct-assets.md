# 0015. Project canvases render assets directly

Date: 2026-07-13

Status: Accepted

## Context

The source mockup's Neural view organizes the workspace as source hubs. That
hierarchy can be useful for a workspace-wide archive, but it is a poor default
inside a project: every direct upload belongs to the `Local` source, so the
canvas collapses the project's actual contents into one circle that must be
opened before any file is visible.

Project-scoped upload also has an asynchronous boundary. The browser can show
the selected bytes immediately, while the authoritative asset row, project
membership, EXIF, and R2 previews arrive through the upload and ingest
pipeline. Waiting for that pipeline makes a successful drop look as though it
did nothing; treating temporary browser data as a real `Photo` would instead
let client state drift from the server.

## Decision

- A project-scoped Neural canvas renders one tile per asset directly. It does
  not render source hubs or require the user to open a `Local` node first.
- Server-provided `Photo` records remain authoritative. Optimistic uploads are
  separate client-only records with temporary object URLs and explicit
  `uploading`, `processing`, `ready`, and `error` states; they are never mixed
  into the server photo collection or replaced with mock imagery.
- A canvas drop is converted from viewport coordinates into content-space at
  the current pan and zoom. A small grid of optimistic tiles is centered on
  that point. File-picker and import-modal uploads have no meaningful canvas
  pointer, so they use the visible canvas center as their anchor.
- Existing assets use a deterministic fixed-grid layout. Per-asset overrides
  store **center coordinates**, keyed first by the temporary upload id and then
  by the returned asset id. Center-based overrides keep the user's anchor
  stable when the worker later supplies the real preview aspect ratio.
- Upload completion maps each input file to its returned asset id without
  relying on filename or parallel completion order. The temporary object URL
  remains visible while the server asset exists without a preview, then is
  revoked once the authoritative R2 preview is available, immediately when an
  item enters an error state, or when the workspace unmounts.
- The existing workspace Realtime job subscription also observes terminal
  ingest updates. A terminal ingest triggers `router.refresh()`, allowing the
  new server `Photo` records and preview URLs to replace the optimistic state
  without remounting the canvas.
- The old workspace-global `/projects/all` source-hub canvas is removed from
  navigation. Its legacy route renders direct asset tiles as a read-only
  recovery surface, so existing uploads without project membership remain
  selectable and can be added to a project. New uploads begin only inside an
  open project, where destination and immediate placement are unambiguous.

## Consequences

Files dropped into a project appear where the user dropped them immediately,
and the upload pipeline changes their status rather than making them disappear
behind a source node. File-picker imports remain predictable because they land
at the center of the current view.

Temporary previews require disciplined URL cleanup and reconciliation across
upload success, partial failure, project-link failure, ingest completion, and
unmount. The server remains the source of truth for identity and metadata, in
line with the Asset ≠ File model in [0011](0011-asset-over-file.md).

The fixed grid and center overrides are client-side layout behavior until the
Phase 5 `PUT /api/canvas/layout` persistence work lands; a full reload may
therefore return manually positioned assets to their deterministic defaults.
Rendering project assets directly also does not replace the Phase 5
aggregate/virtualization requirement for archives with tens of thousands of
assets. The hidden recovery route is not a replacement for that API. A future
workspace-wide library, if needed, should be a secondary grid surface rather
than a source circle in the project navigation flow.
