# ADR 0048 — Canvas edges are relations, not annotations

Date: 2026-08-18

Status: Accepted, then **Parked** (2026-08-21 — see the amendment below)

## Context

A Workspace (`board`, ADR 0044) is where files are curated before CREATE turns
them into an article or a carousel (ADR 0045). The gap between those two stages
is a thinking layer: the author wants to *connect* things — chain photos into a
narrative sequence, attach a note to the photo it is about — the idiom of
node-based creative canvases, and then have those connections mean something
when generation runs.

Three product decisions frame this:

1. **Connections are structured context, not decoration.** A chain of
   photo↔photo edges (a *thread*) is the author's narrative order and becomes a
   source option in the CREATE brief. A note wired to a photo becomes that
   photo's author context in the generation prompt (`authorNotes` — see the
   ADR 0045 amendment that lands with the CREATE integration).
2. The MVP "pull an edge into empty canvas" action spawns a **wired sticky
   note**; the drop menu is an extensible list (AI actions, Create-from-thread
   later).
3. Edges exist **only inside an open Workspace, on the neural view**. The
   project canvas stays a pure sorting surface.

Where should an edge live? The canvas has two documented storage doctrines:

- ADR 0022/0034: tile arrangement is a per-user **view preference** —
  membership is data, geometry is a client override in `localStorage`.
- ADR 0041: an annotation's geometry **is its content** — a note exists
  nowhere else, so its x/y is a server column.

An edge fits neither cleanly, and that misfit is the finding: an edge's two
endpoints sit on *opposite sides* of that line. A photo endpoint's position is
a per-user localStorage override; a note endpoint's position is server-held.
Any stored edge geometry would go stale against one endpoint or the other.

## Decision

**An edge is a RELATION: it stores references only and carries no geometry.**
Its on-screen path is derived at render time from wherever its endpoints
currently are. Concretely, a new `canvas_edges` table:

- **Two nullable FKs per side** (`from_asset_id`/`from_annotation_id`, same for
  `to`) with `CHECK (num_nonnulls(...) = 1)` per side. Postgres has no
  polymorphic FKs, and the cascades are the point: purging a photo or deleting
  a note silently takes its edges. A `(kind, id)` pair or jsonb ids would leave
  orphaned edges nothing can render. The API and client see a flat
  `{ kind: "asset" | "annotation", id }` endpoint; only `lib/edges.ts` knows
  the four-column shape.
- **`board_id NOT NULL ON DELETE CASCADE`** — deliberately opposite to
  `canvas_annotations.board_id SET NULL`. A note survives its Workspace because
  it still means something on the project canvas; an edge is only a statement
  inside one Workspace (its threads and its generation context are per-board).
  Boards soft-delete (`deleted_at` + the 30-day sweep), so the CASCADE fires
  only at `sweep_trashed_boards()` time: edges survive the trash window and a
  restore is whole.
- **Edges are immutable**: create and delete only. No `updated_at`, no
  trigger, no PATCH route, and no RLS `update` policy at all — default-deny is
  the enforcement. There is nothing about a relation between two ids to edit;
  re-drawing is the edit.
- **Direction is stored, not displayed.** The drag has a natural from→to and
  thread ordering prefers it, but a pair exists once per board regardless of
  drawn direction — a unique index over
  `(board_id, least(endpoint_a, endpoint_b), greatest(...))` makes the
  reversed duplicate a `23505`, which the API surfaces as 409.
- **RLS**: the house template (`is_member` select / `is_editor`
  insert+delete) plus per-endpoint pair-checks in the INSERT policy (the
  `board_assets` precedent): asset endpoints require `is_editor_of_asset`,
  annotation endpoints require editorship of the annotation's workspace, and
  the board must belong to the row's own workspace. What RLS deliberately does
  **not** prove is that endpoints are *members of that board* — cross-row
  coherence needs a trigger, not a CHECK, so the API route validates it and
  answers one undifferentiated 404. RLS guarantees tenancy; the route
  guarantees board coherence.
- note↔note edges are representable but have no writer in the MVP — the same
  "one unused shape costs less than a second migration" argument as the `'ink'`
  enum value in ADR 0041, in a schema where migrations are append-only.

## Consequences

- Rendering derives every path per frame from current endpoint positions
  (photo: the tile override; note: the server row), so edges follow drags for
  free and there is no stored geometry to go stale. An edge whose endpoint is
  hidden (label filter, collapsed folder) simply doesn't render — an edge is a
  statement about two visible things.
- Undo/redo must treat a restored note's edges specially: a note re-created by
  undo gets a new uuid, so its edges re-POST only after the note's id is known.
- The thread derivation (connected components; only simple paths count; walk
  from a degree-1 end preferring stored direction) and the generation seam
  (`authorNotes` assembled server-side from board-scoped edge joins, the
  "direction, not evidence" prompt boundary) are specified in the CREATE
  integration and its ADR 0045 amendment; this ADR owns only the storage
  model.
- The pgTAP suite (`supabase/tests/020_canvas_edges.sql`) pins the shape:
  endpoint CHECKs, direction-insensitive uniqueness, immutability as a
  zero-row no-op, the pair-checks, endpoint cascades, and the trash-window
  contract (edges survive `deleted_at`, die at the sweep).

## Amendments

### 2026-08-21 — the feature is parked; the table stays

Three days of live use answered the product question: connecting files on the
Workspace canvas is premature for the current workflow, and the surface cost
(ports on every tile, one more gesture to learn, a third source option in the
brief) was not yet paying for itself. The whole user-facing feature — ports,
wires, EdgeLayer, the drop menu, threads in CREATE, `authorNotes` in
generation, `/api/edges` — was removed in one commit, cleanly rather than
flagged off: dead code guarded by a flag still burdens every change to a
6,000-line hook, while git keeps the full implementation one `git revert`
away.

**The `canvas_edges` table and its pgTAP suite stay.** Migrations here are
append-only, the table is empty and costs 64 kB of indexes, and "parked" is
not "rejected" — this is the same argument that put `'ink'` in the annotation
enum before it had a writer. If the feature returns, the storage model above
is already proven; if it is ever rejected outright, dropping the table is a
one-line migration then.

Nothing writes or reads `canvas_edges` as of this amendment; any rows drawn
during the live-testing window are inert.
