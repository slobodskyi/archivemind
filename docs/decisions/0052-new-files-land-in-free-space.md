# 0052. New files land in free space

Date: 2026-11-12

Status: Accepted

## Context

A drop or **Add files** centred its block on the anchor (`droppedAssetCenters`)
and never looked at what was already there, so a batch dropped onto a crowded
part of the Canvas landed on top of the tiles under it. Cloud imports and Paste
placed nothing at all: their files arrived with no override and took the next
default grid slot — a slot an earlier upload batch or a dragged tile may already
hold. Uploaded while a Workspace was open, a file was placed among the
Workspace's tiles but never joined the Workspace (an upload joins the project),
so on the project canvas it also fell back to an unchecked default slot.

## Decision

- **`placeInFreeSpace`** (`lib/layout.ts`) places a batch as the nearest free
  block to an anchor, on the default grid's lattice (centres at 172 + 184·i,
  178 + 176·j for any integers). A cell is free when a 148×148 footprint — the
  long edge of any tile, so the real aspect cannot make it collide later — misses
  every obstacle grown by 12 px. The search walks a fixed, distance-ordered list
  of offsets out to 24 cells (ties: below before above, right before left) and
  falls back to directly below all content, which is free by construction.
  Deterministic; no `Math.random`.
- The block keeps the near-square drop shape, but its **last row is
  left-aligned**: a row shorter by an odd count, centred, would sit half a cell
  off the lattice.
- **Obstacles** are what the Canvas draws or merely hides: every tile of the
  active scope from the unfiltered layout — label-hidden tiles (a filter hides,
  never moves — ADR 0040) and pending upload tiles included — plus the sticky
  notes and folder boxes drawn in that scope, plus reservations whose photo has
  not arrived yet, plus wherever an undo/redo snapshot would put a tile or a note
  back (a tile dragged out of a cell returns to it on Cmd+Z). Members of a
  collapsed folder are not drawn and do not count.
- **Anchors.** A drop: the drop point. Add files: the viewport centre. A drop in
  Timeline/Topic: below the Canvas content, snapping to Canvas as before. When the
  placed block is off-screen the camera pans to it at the **same zoom** — unless
  a colour label filter is on, which hides new (unlabelled, still uploading)
  files: the pan would land on canvas that looks empty, so the camera stays (a
  sorted-view drop keeps its plain re-fit).
- **Imports and Paste reserve as soon as their ids are known** — an import on its
  response (`ImportModal`'s `onImported`), a Paste only **after the server
  confirms** the link (the route answers a count, not ids, so a reservation made
  before a failed paste would squat the spot). On the Canvas the block goes near
  the viewport centre; **in Timeline/Topic it goes below the Canvas content and
  the view does not snap** — a finished import is not a gesture on the canvas.
- **While a Workspace is open**, files joining the project (imports, Paste, and
  uploads at settle) are reserved in the project canvas's stored arrangement,
  below its content, with that canvas's in-flight drops as obstacles. Nothing
  else writes that key while a Workspace is open. A file dropped on the project
  canvas that settles after a Workspace was opened keeps its drop point: its
  centre is re-keyed from the clientId to the asset id inside that blob.
- **Default slots are pinned before the list changes.** `assetGallery` hands
  default slots out by list index over the newest-first (`created_at`) list, so
  a file older than the newest ones — a Paste, a deduplicated import or upload —
  joins the middle and pushes every later un-dragged tile on by one slot, into
  cells a placement saw as free. Every reservation therefore also pins the
  scope's drawn tiles at their current default centres (`defaultSlotCenters`),
  and so does the render-phase sync whenever photos arrive — the delete-time
  freeze in `deletePhotos`, applied to the opposite edit. Nothing visibly moves;
  Tidy up still clears it all back to the default grid.
- A **safety net** in the render-phase sync pins arrivals that are new (absent
  from the previous server list and from `state.photos`), carry no override, and
  whose default slot is crowded — as one block below the content, no camera move.
- Reservations and pins are **folded into every undo/redo snapshot**
  (`withAssetOverrides`, existing entries win) and are never an undoable step, so
  Cmd+Z never takes an arrival away; and because placement also avoids every
  snapshot's own tiles and notes, it cannot bring anything back onto one.

## Consequences

Deliberately unchanged: a manual drag may still overlap
(`OVERLAP_EPSILON`/`nudgeOffOverlap` only stops a near-exact cover), Tidy up
still resets to the default grid, and a folder's Ungroup still uses
`droppedAssetCenters`.

Known limit: photos that arrive while nobody has the project canvas open take
default slots until someone tidies — a OneDrive folder the worker expands, a
share-link upload, `linkedExisting` imports (the response carries no ids), assets
linked from another device, and arrivals that came in while a Workspace was open
(the safety net runs only on a server refresh, and only over the open scope's
files). A reservation for an asset that ingest later merges into a duplicate stays
as an inert override.
