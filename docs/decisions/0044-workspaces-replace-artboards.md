# 0044. Workspaces replace artboards

Date: 2026-08-11

Status: Proposed (frontend shipped in localStorage; backend is this document's build list)

Supersedes [0043](0043-artboard-connect-content-packs.md) (artboard "Connect" →
content packs): the artboard is gone, and the working surface + the "these files
are one connected project" analysis both move onto the **Workspace**. Builds on
[0034](0034-canvas-groups-folders-and-artboards.md) and reuses the seven-colour
vocabulary of [0040](0040-colour-labels-as-a-human-curation-axis.md).

> **Note for the next agent (Oleksandr's Claude):** the frontend half is on
> `feat/workspace-tools-edits` when you read this, backed by `localStorage`. The
> **backend half below is not built** — this ADR is the spec. Migrations are yours,
> PR-only (CONTRIBUTING.md).

## Context

A project used to open one canvas with the working features (artboards, folders,
sticky notes, ink) living on it, and a sub-region — the *artboard* — was the place
you assembled a set of files to work on and export (ADR 0034/0035; 0043 tried to
make an artboard a "content pack").

That conflated two jobs. The redesign splits them:

- **Sorting views** (Canvas, Timeline, Topic, Map) browse **all files in the
  project** — for finding, organizing and selecting.
- **Workspaces** are the *working* surfaces: a named, colour-coded set of files you
  assemble, work on (sticky notes, folders, drawing, create-new, export) and that is
  understood as one connected project. **A workspace is what an artboard was, promoted
  to a first-class, browsable entity** — so artboards are removed entirely.

"Workspace" is the UI word. In code it is a **`board`** (`lib/boards.ts`,
`hooks/useBoards.ts`) to avoid colliding with the account-level tenant `workspace_id`.

## Decision

### What ships now (frontend — `localStorage`)
- A `Board` = `{ id, name, color (AssetLabel), assetIds[] }`, persisted per project
  in `localStorage` (`lib/boards.ts`). `useBoards(projectId)` owns CRUD + selection.
- **Header browser** (`components/header/BoardBrowser.tsx`): `All files` + a chip per
  workspace (colour dot · name · count) + a ＋ to create + a `+N ▾` overflow;
  double-click renames, the active chip can delete.
- **Modes** (`ArchiveWorkspace`): no board open → sorting views (dotted grid, sorting
  tools bar, bottom switcher) over the whole project; a board open → its working
  canvas (lines grid, `WorkspaceActionBar`, folders + sticky notes), scoped to the
  board's files by a new `boardScopeIds` argument threaded into `useWorkspace`'s
  `filteredPhotos` seam. The switcher and sorting bar hide inside a board.
- **Add to a workspace**: select files in a sorting view → the left-toolbar "ADD n"
  button → `AddToProjectPopover`'s "Add to workspace" section (existing board, or a
  new one seeded with the selection).

### What the backend must build
- **`boards` table**: `id`, `workspace_id` (tenant), `project_id`, `name`, `color`,
  `sort_order`, timestamps. **`board_assets`** M:N (`board_id`, `asset_id`). RLS by
  tenant like every other table. The client currently owns ids + membership in
  `localStorage`; the migration is the durable, shareable home.
- **`GET/POST/PATCH/DELETE /api/boards`** and **`POST/DELETE /api/boards/[id]/assets`**
  — mirror `app/api/canvas-groups/*`. Read seam `lib/boards-server.ts` awaited by the
  project page, so boards are in the first paint (like `getCanvasGroups`).
- **Per-board working state**: today folders (`canvas_groups`) and sticky notes
  (`canvas_annotations`) are project-scoped, so they show across every board. Give
  both an optional `board_id` so a note/folder/arrangement belongs to one workspace.
  (Frontend increment 1 does NOT scope these yet — call it out.)
- **Higher-level analysis**: when a board's membership changes, enqueue a job so the
  board is understood as one connected project (the 0043 content-pack idea at board
  level) — a synthesised summary + embedding powering the future "create a new file
  from this workspace" (the ＋/generate flow 0043 sketched). New `jobTypeSchema`
  members as needed; credits per `packages/shared/src/usage.ts`.

## Consequences

- **Easier**: the two jobs (browse vs work) each get a surface built for them;
  workspaces are first-class and shareable once the table lands; the confusing
  artboard-as-sub-region is gone.
- **Harder / given up (for now)**: boards don't sync across devices/teammates until
  the table exists; per-board notes/folders/arrangement need the `board_id` columns
  above (increment 1 shares them project-wide); the connected-project analysis is
  stubbed. All accepted to validate the interaction first.
- **Removed**: artboards (`Frame`/`FrameOverlay`, frame gestures, `createPackFile`)
  are deleted from the UI; residual frame state in `useWorkspace` is dead and gets
  swept in a follow-up.
