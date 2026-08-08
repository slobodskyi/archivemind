# 0041. Annotations live on the server, geometry and all — and only on the Workspace view

Date: 2026-08-08

Status: Accepted

Extends [0022](0022-timeline-clouds-and-live-cloud-labels.md) (canvas arrangement
is client-only `localStorage`) and [0034](0034-canvas-groups-folders-and-artboards.md)
(membership on the server, geometry on the client) by carving out one deliberate
exception. Reuses the seven-colour vocabulary of
[0040](0040-colour-labels-as-a-human-curation-axis.md).

## Context

Sticky notes shipped as part of the canvas *arrangement*: a `StickyNote[]` in the
same `localStorage` blob as tile drag overrides, frames and folder geometry
(ADR 0022). That put them on the wrong side of a line the schema otherwise draws
carefully.

Three problems followed from it, and a fourth was about to.

**1. A note is invisible to everyone but the browser that typed it.** Two people
share a workspace and every other authored thing they make — a project, a folder,
an artboard, a caption, a confirmed fact, a colour label — is shared. A note is
the only one that is not. It also does not survive a cache clear, and it does not
exist on the iPad you opened the same archive on.

**2. Notes rendered in views they mean nothing in.** `StickyNoteOverlay` sat
*outside* the `view === "neural"` guard that already wrapped the artboard and
folder overlays, so a note drawn over the Workspace arrangement also drew over
Topic, Timeline and Labels — three views that lay the same tiles out completely
differently, each in its own `GalleryOverrides` bucket. On Map it was merely
hidden behind the basemap. The note was not *wrong* in those views so much as
meaningless: there is no position it could have been carried to that would still
say what it said.

**3. The persisted blob is a silent-loss path.** `localStorage` is ~5 MB per
origin, shared with every project's drag overrides, and the save is wrapped in a
bare `catch {}` — over quota, an arrangement (and every note in it) simply stops
persisting with no signal. Tolerable for coordinates that can be re-dragged.
Not tolerable for text a person wrote.

**4. Freehand ink is coming, and it does not fit at all.** Five seconds of Apple
Pencil at 120 Hz is ~600 samples, ~20 KB of JSON; a hundred strokes is ~2 MB. Ink
in `localStorage` is not a tight fit, it is a guaranteed one-session-and-lost
feature — on the device where drawing is most natural and least likely to be the
device the work is finished on.

The obvious objection is that ADR 0022 already considered and rejected syncing
canvas positions, and ADR 0034 restated the split as "membership is data,
geometry is a per-user override". Moving a note's `x`/`y` to the server looks
like reopening exactly that.

It is not, and the difference is not a matter of degree:

> A photo **exists independently of the canvas**. Its tile position is one user's
> view preference over a thing that is already there — which is why two people
> can hold different arrangements of the same archive without either being
> wrong, and why a re-cluster is free to move it.
>
> An annotation **does not exist anywhere else**. Its position is not a view onto
> content; it *is* the content. A note at no particular place is not a note, and
> a circle drawn around nothing is not an annotation. There is no second copy of
> it for the coordinates to be a preference *about*.

## Decision

**1. New table `canvas_annotations` (migration `20260808000002`), carrying its own
geometry.** `workspace_id`, nullable `project_id` (null = the workspace-wide
`all` canvas, the same scoping as `canvas_groups`), `kind`, `x`/`y`/`w`/`h`,
`color`, `body` jsonb, `style` jsonb, `created_by`, timestamps. RLS mirrors
`canvas_groups` exactly: select = `is_member`, writes = `is_editor`.

This does **not** move canvas layout to the server. Tile positions, frames and
folder geometry stay exactly where ADR 0022 and ADR 0034 put them. The line moved
by precisely one class of object, the class whose coordinates were never a
preference.

**2. `kind` is an enum with `ink` in it from day one, though nothing writes it
yet.** This migration exists so that freehand ink — the actual motivating feature
— can land as UI plus a `body` shape, with no second migration. Migrations here
are append-only and owner-gated (CONTRIBUTING.md), so the cost of guessing the
shape late is much higher than the cost of one unused enum value.

**3. Style is a `color` column plus a `style` jsonb, not a column per knob.**
`color` is real and typed because it must not drift; everything else
(`fontSize`, and whatever the note gains next) lives in `style` and is parsed by
`noteStyleSchema` in `packages/shared` — the same arrangement `canvas_groups.settings`
already has with `artboardSettingsSchema`, including the property that a row
written before a new knob existed still parses, defaults filling the gap.

**4. `color` reuses the `asset_label` enum — the ADR 0040 seven, not a fifth
palette.** Sticky notes shipped with four hardcoded hexes (`STICKY_NOTE_COLORS`)
that were their own private vocabulary. The workspace already has a colour
vocabulary: the seven macOS colours, *with per-workspace names the user chose*
(`workspace_labels`). Reusing the enum means "yellow" means one thing in this
product, and a workspace that renamed yellow to "Client picks" gets that name on
the note swatch for free.

The type's name is asset-flavoured and the reuse is deliberate anyway: it is the
schema's name for *the seven colours*, and a parallel `note_color` enum with
identical members is exactly the drift this avoids. A note is `not null default
'yellow'` — unlike a label, it has no unset state; every note is some colour.

**5. Annotations render, and can be created, only on the Workspace (`neural`)
view.** The gate that already wrapped `FrameOverlay` and `FolderOverlay` now
wraps `StickyNoteOverlay` too, and both entry points (the left toolbar button,
the right-click item) are gated on the same condition. This is the rule that
makes an unanchored annotation coherent: there is exactly one arrangement it can
be positioned against, and the four sorting views cannot invalidate it because
they write to different override buckets entirely.

The consequence worth stating plainly: **annotations get no anchor.** They do not
follow a tile. Dragging a photo out from under a circle leaves the circle behind,
and importing 200 new photos reflows un-dragged tiles underneath existing notes.
This is what FigJam does, it is what the single-view rule buys, and it is the
reason this ADR needs no equivalent of ADR 0038's staleness machinery.

**6. Existing `localStorage` notes are adopted once, then dropped from the
blob.** On first load of a scope whose server side is empty, any notes in the
persisted arrangement are POSTed and the local copy is cleared, guarded so it
cannot run twice and cannot duplicate across devices. `stickyNotes` leaves
`PersistedCanvas`.

## Consequences

**Easier.** Notes are shared, survive a cache clear, and are on every device —
which is the whole premise of adding them on an iPad. Ink now has somewhere to
go that is not a 5 MB budget shared with every project's drag overrides, and it
lands without another migration. The follow-up "note settings" work (colour,
font size, checkbox lines) is UI plus a zod field, with no schema change. The
seven colours cannot fork into two palettes.

**Harder.** A note is now a network round trip: creating, typing, dragging and
deleting all reconcile against the server, so the code gains optimistic state and
failure handling that a `setState` never needed. Typing needs debouncing to avoid
a PATCH per keystroke. Two people editing one note's text will last-write-wins —
acceptable, because that is already true of a project name and a caption, and
real co-editing is not something this product has anywhere.

**Given up.** Offline note-taking: with the arrangement in `localStorage` a note
worked with no connection, and now it does not. Judged the right trade, because
a note only the disconnected browser can see was the defect being fixed.

**Not addressed.** Z-order between annotations. `tileZ` is still client-side and
the ordering question spans tiles, folders and notes together, so a note-only `z`
column now would very likely be the wrong shape — deliberately left out rather
than guessed at. Annotations also do not appear in exports; a PDF is built
server-side from asset ids and an artboard's ink is a working mark, not part of
the deliverable (same call FigJam makes).
