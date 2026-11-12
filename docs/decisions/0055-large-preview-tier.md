# 0055. A 2048 px preview tier

Date: 2026-11-12

Status: Accepted

## Context

The largest picture the archive held of a photo was its 1024 px `medium` webp.
The fullscreen viewer (ADR 0054) fits a photo to the whole screen, and a
laptop's retina screen is about 2900 device pixels wide, so even "fit" was a
2–3× upscale.

The originals step (ADR 0054's amendment) fixes that only for an original that
is held in R2, that a browser can decode, and that belongs to an unedited
photo. Everything else stayed soft:

- Google Drive and OneDrive files, whose originals never enter R2 (ADR 0025,
  ADR 0047);
- RAW and TIFF, which no browser draws;
- HEIC outside WebKit;
- every edited photo, whose edit existed only as 1024 px renders (ADR 0030);
- every photo on touch, where the original deliberately waits for the first
  zoom (iPad memory).

## Decision

**1. A third preview size, `large`: 2048 px on the long edge.** It is the same
webp q82 through the same pipeline (`PREVIEW_SIZES` in
`apps/worker/src/services/previews.ts`). It is written only when the source is
*bigger* than medium (`previewSizesFor`). Below that, `withoutEnlargement` would
store a second copy of medium's pixels under another name. thumb and medium are
written for every source, as before. `asset_previews.size` is free text, and
every existing reader filters on the size it wants, so the new rows need no
schema change and no reader sees them unless it asks.

**2. Ingest writes it from now on, for every source.** That includes new
Google Drive and OneDrive imports, because ingest already has their bytes in
hand.

**3. A background backfill covers what was ingested before, for originals we
hold.** `apps/worker/src/large-backfill.ts` runs on boot and on the retention
sweep's 6-hour tick, beside the geo backfill (ADR 0026). Each pass:

- handles up to 200 photos, newest first (`LARGE_BACKFILL_PER_RUN` overrides
  this on Railway; `0` switches the backfill off);
- works one photo at a time, and stops between photos when the worker shuts
  down;
- leaves a photo alone for its first hour, while its own ingest may still be
  writing previews.

What it may touch:

- **Only originals under `{workspace_id}/originals/`**, which means uploads
  and Dropbox. It never fetches from Google Drive or OneDrive. That would
  spend a user's OAuth token and quota on work they did not ask for, possibly
  long after they stopped using the connection. Those files gain `large` when
  imported anew.
- **Only photos whose stored medium is 1024 px on its long edge.** A smaller
  original already lives at full size in medium.

What it does when there is nothing to write:

- An original that turns out to be no bigger than 1024 px, does not decode, or
  fails is remembered **in memory**. The next boot retries it once. That costs
  a few downloads per deploy and avoids a table that would exist only to record
  failures.
- The new row is written only while the asset is still `active`. Otherwise the
  object it just put is deleted, so a photo trashed mid-pass cannot leave purge
  a preview it never knew about.

**4. Edits render from `large` and get their own large render.** Migration
`20261112000002` adds `asset_edits.edited_large_key` and `large_bytes`.

The edit handler:

- renders from the photo's best *unedited* preview: `large` when there is one,
  otherwise medium;
- emits an edited `large` only while the cropped result is still bigger than
  medium;
- deletes the previous edited large render when a tighter crop stops earning
  one.

Once an edited photo gains its `large` from the backfill, the edit is
re-rendered through an ordinary `edit` job with **no recipe in its payload**
(`user_id` null):

- a recipe-less job re-renders the *stored* recipe, read when the job runs and
  not when it was queued, so it can never reinstate an older edit;
- it updates the row only where the recipe still matches. Matching uses the
  JSON as stored, because zod's re-serialisation would make every older edit
  look changed. If the edit was reset or replaced meanwhile, it throws away
  what it rendered.

**5. The read path.**

- `GET /api/assets/[id]/medium?size=large` answers `{ url }`, or
  `{ url: null }` when there is nothing larger than medium.
- An edited photo answers with its edit's large render or with null, and never
  with its unedited large preview, which would quietly undo the edit on
  screen.
- `?original=1` still skips the edit.

The viewer's ladder becomes thumb → medium → **large** → original:

- `large` is asked for after a 150 ms dwell (`largePreviewUrls`, the same
  tab-wide cache, keyed like the medium so a landing edit asks again; a "none"
  is cached too);
- on a desktop it is **skipped** when the original is about to load anyway,
  because two downloads of one photo for one look are waste;
- on touch it is the fit step before the first zoom;
- on an edited photo it is the edit's own large render;
- the chip reads `Preview 2048×1365`.

**6. Storage accounting stays exact.**

- `workspace_usage()` and `trash_items()` are re-created verbatim except that
  an edit's sum now includes `large_bytes`. A null is "no such file", not
  "unmeasured", because no file was written.
- Unedited `large` rows were already counted, because both functions sum every
  `asset_previews` row.
- Purge erases `edited_large_key`, and an edit reset deletes it.

## Consequences

- **Storage grows.** A 2048 px webp is roughly three to four times the bytes of
  its medium, a few hundred KB per photo. It shows on the Usage page under
  previews, and per photo in the Trash.
- **The backfill downloads each R2-held original once**, and decodes it the way
  ingest did (`decodeBytes`, now exported, so HEIC and RAW's embedded JPEG take
  their usual routes). At 200 per 6 hours a large archive takes days to catch
  up, newest photos first. The env var exists for when that is too slow or too
  heavy.
- **Older Drive and OneDrive files stay at 1024 px** until they are imported
  again. The chip already says so.
- **An edit made before this** stays at its 1024 px render until its photo is
  backfilled, which re-renders it.
- **Exports, share links and publications still use medium.** That is
  deliberate: what they deliver did not change here.
- **Deploy order matters.** The worker, purge, the medium route and the edit
  reset all name the new `asset_edits` columns. The migration has to be on
  production before this code is, or edits and purges fail and an edited photo
  falls back to its unedited medium.
- **Not verified:**
  - the backfill on Railway against real originals;
  - a real iPad decoding a 2048 px webp. At about 11 MB of pixels it is far
    below the originals that step exists to protect against.
