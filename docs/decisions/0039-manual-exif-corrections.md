# 0039 — Manual EXIF corrections are written in place, not layered over

## Status

Accepted — 2026-08-05.

## Context

PR #184 shipped a pen toggle in the drawer that flips Metadata/EXIF between
read-only and editable. It had no backend: the draft lived in component state
and was discarded the moment the user opened another photo. Only the button's
tooltip admitted it, so a user who corrected a camera name and clicked "Done"
had every reason to think the fix had been saved.

Correcting this metadata is not cosmetic. The values reach further than the
drawer that displays them:

- `taken_at` places the photo on the Timeline's date axis (ADR 0024) and answers
  the search RPC's date filters;
- `camera_make`/`camera_model`, `iso` and `aperture` are three of that RPC's own
  EXIF filters (ADR 0031, migration `20260722000004`);
- `gps_lat`/`gps_lon` decide whether the photo gets a marker on the Map or is
  counted in the "no location" chip (ADR 0027);
- all of it is exported in the captions CSV (ADR 0035).

A photojournalist's archive is full of files that are wrong in exactly these
fields — a body whose clock was never set, a scanned negative dated by the
scanner, a phone that stripped GPS. So the question was not whether to store the
correction but where.

`asset_exif` is worker-written (service role) and had only ever carried a SELECT
policy, so before this change a browser write was impossible rather than merely
ungranted.

## Decision

**Corrections are written into `asset_exif`'s own columns**, with two new
columns recording provenance:

- `edited_fields text[]` — which columns a human corrected;
- `original_values jsonb` — what ingest had extracted, snapshotted per column the
  first time that column is overwritten.

Three consequences follow directly:

1. **Every reader gets the correction for free.** The Timeline, the Map, both
   search RPCs and the export handler already select these columns. None of them
   had to change, and none of them can forget to.
2. **The ingest upsert must hold back edited columns.** It runs on far more than
   a first ingest — a dedup revival, a retry, and the #113 HEIC re-extract all
   reach it — so each column in `edited_fields` is preserved with a per-column
   `CASE` instead of taking `excluded`. `focal_length` and `raw` are not
   user-editable and always take the fresh value.
3. **Revert restores from the snapshot, not from `raw`.** `raw` holds the full
   original dump and was the obvious source, but it is the *extractor's*
   vocabulary — exifr's keys, or exiftool's on the HEIC path — and only the
   worker's `extractExif` knows how to turn that back into our columns. Reverting
   from it would mean a second copy of that mapping in the web app, free to drift
   from the one that produced the values.

Writes are gated the way `topic_clusters` renames are (ADR 0038): RLS policies on
`is_editor_of_asset` for the row, plus a revoke-then-column-grant narrowing which
columns an editor may write at all. `raw`, `focal_length` and `asset_id` are
outside the grant, so naming one raises 42501 instead of silently doing nothing.

GPS is editable as a lat/lon pair, and writing it sets `location_source` to
`'manual'` — the value `init.sql` anticipated in its own comment. The pair moves
together or not at all: half a coordinate is not a location, and it would put a
marker on the null island rather than show an error.

## Consequences

- The original of every corrected field survives and Revert is exact.
- An overlay table (the `asset_edits` shape from ADR 0030) was rejected: it is
  non-destructive by construction, but every reader would have to merge it,
  including two SQL functions, and a reader that forgot would quietly show the
  wrong value while the UI insisted the photo had been fixed. Writing in place is
  also the house pattern for "the worker produced a value, a human corrected it"
  — captions do exactly this with `is_edited`.
- A corrected value is indistinguishable from an extracted one once stored, which
  is why `edited_fields` also drives a per-field dot in the drawer. Provenance
  matters most to the second person reading the archive.
- `original_values` is inside the column grant, unlike `topic_clusters.centroid`.
  Forging it makes the caller's own Revert restore a wrong number and touches
  nobody else, so it does not earn the extra defence a workspace-wide k-means
  anchor does.
- Editing is offered on real assets only — a mock row has no `asset_exif` row to
  correct.
- Not done here: `focal_length` has no editor, there is no per-field undo (Revert
  is all-or-nothing, matching the single control), and nothing writes the
  correction back into the exported file's own EXIF/IPTC headers. The last one is
  the interesting follow-up — a corrected archive that exports uncorrected files
  has only half-solved the problem.
