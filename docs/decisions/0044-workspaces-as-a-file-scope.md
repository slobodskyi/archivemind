# 0044. Workspaces — a named file scope on a project's canvas

Date: 2026-08-12

Status: Accepted — frontend 2026-08-12, backend (migration `20260812000001`)
the same day. The `localStorage` stage below is history; see the second amendment.

Builds on [0034](0034-canvas-groups-folders-and-artboards.md) (canvas geometry is
a per-user override) and reuses the seven-colour vocabulary of
[0040](0040-colour-labels-as-a-human-curation-axis.md).

> **Note for the next agent:** the frontend half below is built and backed by
> `localStorage`. The **backend half is not** — this ADR is its spec. Migrations
> belong to Oleksandr and land PR-only (CONTRIBUTING.md).

## Context

A project opens one canvas holding every file in it. That is the right default
for finding things and the wrong one for working on a few: assembling six photos
for a pitch means dragging them clear of four hundred others that stay on screen
the whole time.

The artboard (ADR 0034) was the existing answer — a rectangle you draw around
tiles. It has two problems. It is a *region*, so which files are "in" it is
derived from coordinates and changes when anything moves; and it is invisible
until you scroll to it, so a project's working sets are not browsable.

The redesign George proposed makes that set a first-class, named, browsable
thing. This ADR takes that idea and lands it **additively** — nothing that works
today stops working.

## Decision

A **Workspace** is a named, colour-coded set of a project's files. In the UI it
is "workspace"; in code it is a **`board`** (`lib/boards.ts`, `hooks/useBoards.ts`)
so it cannot be confused with the account-level tenant `workspace_id`.

### What ships now (frontend, `localStorage`)

- `Board = { id, name, color: AssetLabel, assetIds[] }`, persisted per project.
  `loadBoards` drops malformed entries rather than throwing — a hand-edited or
  older blob must not take the canvas down with it.
- **Header browser** (`BoardBrowser`, in the breadcrumb slot the retired
  `WorkspaceToggle` left free): `All files` plus a chip per workspace (colour dot
  · name · count), a ＋ to create, an overflow, rename and delete.
- **Opening one narrows the canvas to its files. That is all it does.** Sticky
  notes, folders, artboards, the four views, export, the label filter and every
  action bar behave exactly as they do with no workspace open. This is the
  deliberate difference from the design that prompted it, which made a workspace
  a *mode* — its own grid, its own bar, no sorting views, and notes and folders
  visible only inside one. That version hides existing server-side notes and
  folders from anyone who has not created a workspace yet, which is a data
  regression dressed as a layout choice.
- **Add to a workspace**: select files → the left rail's `ADD n` →
  `AddToProjectPopover`'s "Add to workspace" section (an existing one, or a new
  one seeded with the selection). It sits beside the artboard section rather than
  replacing it, because artboards still work.

### Where the scope is applied, and why it matters

The scope is applied in `canvasPhotos()` — the set **every layout reads** — and
mirrored into `WorkspaceState.boardScope` so `activeTilePositions` sees it too.

This is the opposite of the colour-label filter, and the difference is the whole
point:

| | label filter | workspace scope |
|---|---|---|
| effect | hides tiles | changes which tiles exist |
| geometry | untouched — every layout still runs over the full set | recomputed over the subset |
| seam | `visibleTilePositions` (render) | `canvasPhotos` (layout) |

A workspace has to re-pack, or six photos would sit at the coordinates they had
among four hundred, scattered across empty canvas. Re-packing means the geometry
seam and the render seam must be computed from the **same** photo set: they are
two different functions (`activeTilePositions` for drags, folder drops, artboard
membership and export order; `activePositions` for what is drawn and what a
marquee can grab), and if only one of them knows about the scope, a drag moves a
tile to a coordinate nobody can see. That is why `boardScope` lives in state
rather than being read from the prop in one place and not the other.

### What the backend must build

- **`boards`**: `id`, `workspace_id` (tenant), `project_id`, `name`, `color`,
  `sort_order`, timestamps. **`board_assets`** M:N. RLS by tenant like every other
  table. The client owns ids and membership today; the table is the durable,
  shareable home.
- **`GET/POST/PATCH/DELETE /api/boards`** and
  **`POST/DELETE /api/boards/[id]/assets`**, mirroring `app/api/canvas-groups/*`.
  Read seam `lib/boards-server.ts`, awaited by the project page so boards are in
  the first paint like `getCanvasGroups`.
- **Per-workspace working state.** Folders (`canvas_groups`) and sticky notes
  (`canvas_annotations`) are project-scoped, so they show in every workspace.
  Giving each an optional `board_id` is the fix. Not done here, and the reason
  this increment keeps them visible everywhere rather than hiding them: shared is
  wrong, invisible is worse.
- **Connected-project analysis** (optional, later): when membership changes,
  enqueue a job that synthesises a summary + embedding for the set, powering a
  future "create a new file from this workspace". New `jobTypeSchema` members and
  credits per `packages/shared/src/usage.ts`.

## Consequences

- **Easier.** Working sets are named, browsable and stable — membership is a list,
  not a rectangle you can move a tile out of by accident. The canvas gets small
  without anything being deleted or moved out of the project.
- **Harder / given up for now.** Boards do not sync across devices or teammates
  until the table exists; notes and folders are shared across a project's
  workspaces; the connected-project analysis is not built. All three are accepted
  to validate the interaction first, and all three are additive to fix.
- **Tile arrangements are shared with the full canvas.** A workspace re-packs
  from the same `galleryOverrides.asset` bucket, so a tile dragged inside one is
  dragged on the project canvas too. Per-board arrangements need the `board_id`
  columns above; until then this is one canvas seen through a narrower window,
  which is at least a rule that can be stated in one sentence.
- **A deleted asset leaves a stale id in a board.** Harmless — membership is
  intersected with the loaded photos everywhere it is read, including the chip
  counts — but the table should clean up with a real foreign key.
- **Artboards are untouched.** They may well be superseded by workspaces once
  these have a server and per-board state; that is a later decision with a
  migration path, not a side effect of this one.

## Amendment (2026-08-12) — a Workspace owns its canvas objects, and the tools

The first increment scoped only photos: notes, folders and artboards showed in
every Workspace and on the project canvas alike, and the working action bar was
on Canvas whether or not a Workspace was open. Both are fixed here.

### Ownership

A sticky note, a folder and an artboard now belong to the Workspace they were
**made in**, and hide everywhere else — the same rule photos follow. With no
Workspace open everything shows, again like photos: the un-scoped canvas is the
project.

- Membership lives on the board (`Board.noteIds` / `groupIds` / `frameIds`), in
  its own `localStorage` blob. A note could carry a `boardId` in its `style`
  jsonb with no migration, and that was rejected: it would **sync a pointer to a
  Workspace that exists in one browser**, leaving the note claiming membership in
  something no other device can resolve. Keeping the whole feature honestly local
  is the coherent half-step. The real home is still the `board_id` column in the
  build list above.
- A photo is many-to-many (it lives in the project and can be in several
  Workspaces); these three are made in one place and belong there, so they are
  plain owned lists rather than a join.
- `useWorkspace` reports `create` / `adopt` / `delete` through one callback. The
  `adopt` case exists for the one object with two ids in its life: a sticky note
  is drawn under a `tmp-` id and takes its row's uuid when the insert returns.
- The filter is applied at the **render** seam, not in `canvasPhotos`. These
  three carry their own geometry and have no layout to re-pack, so a scope has
  nothing to change about where they sit — hiding is the whole effect. That is
  the opposite of photos, and the reason is the same one that put the photo scope
  in the layout seam.

### The tools follow the objects

`WorkspaceActionBar` now renders only on a Workspace's Canvas; everywhere else
gets the narrow `SortingActionBar`. One derived `workingBar` flag drives both, so
there is always exactly one bar and the gates cannot drift.

This is what makes ownership airtight: if the sticky-note button, the folder
button and the artboard tool exist only inside a Workspace, then every object of
those kinds is made inside one and the "belongs to nobody" case stops being
reachable for new objects.

- **Folder** and **Export** are mirrored into the right-click menu. They were
  reachable only from that bar, and a selection outside a Workspace still has to
  reach them.
- **Tidy up** and the **artboard tool** are deliberately not mirrored: both
  arrange a working surface, and that is precisely what a Workspace is.
- Objects made before this shipped belong to no Workspace, so they show on the
  project canvas and in none of the Workspaces. That is the correct reading of
  "made outside one", not a migration gap.


## Amendment (2026-08-12, second) — the backend landed

`boards` + `board_assets` exist, and the build list above is done apart from the
connected-project analysis. What changed from the plan:

- **`boards.project_id` is NOT NULL**, unlike `canvas_groups.project_id`. A
  workspace is a working subset of one project; the `all` canvas is the
  read-only recovery grid and has no browser to open one from, so a null there
  would be a row nothing could reach.
- **Ownership is `board_id` on the object, not a list on the board.** A photo is
  many-to-many — it lives in the project and can sit in several workspaces, so it
  gets `board_assets`. A note, folder or artboard is made in one place and
  belongs there. This replaces the client-side `noteIds`/`groupIds`/`frameIds`
  the first increment used, and with it the whole `create`/`adopt`/`delete`
  callback: the id is written by the server at insert time, so there is no
  second id to adopt when the response comes back.
- **`on delete set null`, deliberately.** Deleting a workspace must not delete
  the notes and folders made in it. They fall back to `board_id is null`, which
  already means "belongs to the project canvas" — a defined state, not a
  tombstone. The pgTAP suite asserts exactly this, because it is the difference
  between a delete that tidies and a delete that loses work.
- **A `board_id` in a request body is validated, not trusted.** RLS on
  `canvas_annotations` and `canvas_groups` checks the ROW's workspace, not what
  this column points at, so without the check a caller could file a note under
  another workspace's board. An unreadable id degrades to null rather than
  404ing a note the user has already drawn.
- **Membership inserts pre-filter to what the caller can see.** An RLS
  `with check` violation raises on the whole INSERT rather than dropping the
  offending row, so one stale id from a client would otherwise reject the entire
  add — the same pre-filter `POST /api/canvas-groups` already does.
- **Artboards keep a client-side `Frame.boardId`.** They are still
  `localStorage` (ADR 0034), so there is no row to carry the column; the meaning
  and the null are identical.
- **`getBoards` degrades to `[]` on 42P01/42703**, like `getCanvasGroups`: a web
  deploy is not transactional with a migration push, and a missing table should
  cost the chip row, not the project page.

### The workspaces that existed in `localStorage`
`readLegacyBoards` adopts them once — name, colour and photo membership become a
real row, then the blob is cleared, and only after every create succeeds so a
failure retries on the next load. The old note/folder/artboard ownership lists
are **not** adopted: re-pointing them would mean a PATCH per object for data that
lived in one browser for a matter of hours, and those objects simply fall back to
the project canvas.

### Still not built
The connected-project analysis (a job that synthesises a summary + embedding when
membership changes) remains unbuilt, and per-workspace tile *arrangements* still
share the project's one `galleryOverrides.asset` bucket.

## Amendment (2026-08-13) — drag onto a chip, and sorting leaves the Workspace

### Dropping onto a Workspace chip
A photo, a sticky note or a folder can be dragged onto a chip in the header to
put it in that Workspace, the way a file is dropped on a folder. **Nothing
leaves All files.** A photo joins a many-to-many, so it is still in the project
and in any other workspace; a note or a folder changes its single owner, and the
project canvas shows every object regardless of owner. The gesture adds, it
never moves-out.

- **Hit-testing, not HTML5 drag-and-drop.** The canvas drives its own pointer
  drags and calls `preventDefault()` on pointerdown, so `dragover`/`drop` never
  fire and a header could not receive a drop the normal way. Chips carry
  `data-board-chip` and `boardChipAt()` resolves the pointer through
  `elementFromPoint` — which is also what lets a drag that began on the canvas
  finish on a `position: fixed` header. Cached rects were rejected: the chip row
  scrolls and overflows, so a rect taken at drag start is wrong by the time the
  pointer arrives.
- **`All files` carries the attribute with an empty value.** Passing over it
  disarms, instead of leaving the last chip lit while the pointer is somewhere
  that means "no workspace".
- **A drop is a change of membership, not of position.** The dragged tiles go
  back where they were picked up, restored from the drag's own history snapshot
  (exact — an override the tile already had survives) with that entry consumed,
  so it is one action rather than an undo step for a move nobody asked to keep.
  This is the bargain the Topic drop already makes. A note restores from
  `d.orig` and saves no move; a folder replays its accumulated delta backwards,
  because `FolderOverlay` applies moves incrementally and keeps no origin.
- **Only a real `pointerup` commits.** A `pointercancel` disarms and writes
  nothing — an armed highlight is not consent.
- Folders run their own window listeners rather than the canvas drag session, so
  they hit-test themselves with the same helper. Their armed chip is tracked in
  `ArchiveWorkspace` beside the canvas one and the header takes whichever is set.

### Sorting views are an All-files activity
`ViewSwitcher` is hidden inside a Workspace, and opening one puts you on its
Canvas. Canvas / Timeline / Topic / Map re-arrange the **whole project**, which
is not the question a Workspace answers — and leaving someone inside one on
Timeline showed them a bar and a grid for a different scope with no switcher to
get back. Done in the open/create handlers rather than an effect, because
opening a Workspace *is* the action that puts you on its canvas.
