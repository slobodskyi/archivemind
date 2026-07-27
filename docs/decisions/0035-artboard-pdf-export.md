# 0035. Artboard → PDF export: worker job, medium-preview source, embedded Cyrillic font

Date: 2026-07-23

Status: Accepted

## Context

The point of an artboard (ADR 0034) is to produce a **final deliverable**: a
user organizes files, gathers them, and exports a document — each photo with its
caption underneath. TECH_SPEC §8.5 had scoped an `export` job as a **ZIP +
`captions.csv` sidecar** (a data dump), and reserved the `export` value in the
`job_type` enum since `init`, but no handler was ever built and `POST /api/jobs`
rejected the type. A laid-out **PDF** (photo + caption per page) is a different,
richer output than the spec's ZIP, and it's what users actually asked for.

Constraints discovered while building:

- **Captions are multilingual (en/uk/ru).** A PDF that embeds only a Latin font
  renders Ukrainian/Russian captions as tofu. The PDF-14 standard fonts don't
  cover Cyrillic, so a real font must be embedded.
- **No PDF library existed** (`sharp` + `pdf-parse`-for-reading only), and the
  web presigner is hard-coded to a 1 h TTL — too short for a deliverable.
- **Edited photos** (ADR 0030) must show the *edit*, and re-rendering full
  originals at export time was explicitly deferred by ADR 0030.

## Decision

**1. Export is a worker job that writes a PDF to R2 — reusing the `edit`-job
shape.** `POST /api/exports` enqueues `ai_jobs {type:'export', payload:{group_id
| asset_ids, options}}`; the worker (`handlers/export.ts`, `pdf-lib` +
`@pdf-lib/fontkit`) renders the PDF, `putObject`s it to
`{workspace_id}/exports/{job_id}.pdf`, and writes a **7-day** presigned URL
(a new worker-side `presignGetLong`, R2's max) into `ai_jobs.payload.result_url`.
The client polls `GET /api/exports?jobId=` once Realtime reports the job done.
Export gets its own route (like `edit`/`purge`), not `POST /api/jobs`.

**2. Source images are the MEDIUM previews, edited-medium when present.** R2
already holds a 1024px medium for every source (upload/gdrive/dropbox), which is
ample for a page and requires no original bytes or source-specific path — so the
export works for Drive-linked assets (whose originals are never in R2, ADR 0025)
and automatically reflects edits (`coalesce(edited_medium_key, medium_key)`).
Full-resolution re-render from the original stays a future quality upgrade, as
ADR 0030 planned. Previews are webp; the worker transcodes each to JPEG via
`sharp` because `pdf-lib` embeds JPEG/PNG, not webp.

**3. Embed a Cyrillic-covering TTF, bundled as a worker asset.** Liberation Sans
(Regular) — OFL-licensed, Latin + Cyrillic + Greek in one file — lives at
`apps/worker/data/fonts/`, resolved the same walk-up-from-`import.meta.url` way
as the GeoNames artifact (ADR 0026), overridable via `EXPORT_FONT_PATH`. A
missing font throws `export_font_missing` rather than silently shipping tofu.

**4. Two layouts, chosen at export time.** `one_per_page` (large photo + title +
caption, portfolio feel) and `grid` (contact-sheet, 2-up with a short caption).
What goes under each photo is configurable (`caption`, `title`, `facts`, `exif`)
— caption + title on by default. Caption text is resolved by the shared
`resolveCaptionText` (exact lang×style → English-of-style → any → "") so web and
worker never disagree on which caption a photo shows.
*(Amended 2026-07-27 — `facts` is gone and `grid` never honoured `title`/`exif`;
see Amendments.)*

## Consequences

- A working PDF deliverable reusing all existing plumbing (job queue, R2,
  Realtime, presign). v1 exports a saved artboard/folder (`group_id`, ordered by
  `position`) **or** an ad-hoc selection (`asset_ids`, capture-at-export), so the
  Export button works before artboards are server-backed (ADR 0034 §5).
- A bundled font binary now ships in the repo (with its OFL NOTICE). Swappable
  via `EXPORT_FONT_PATH` or by replacing the file.
- This is a **superset** of TECH_SPEC §8.5, not the ZIP+CSV it described; the
  ZIP/originals bundle can still be added later as another `export` payload
  shape. `usage_events` still carries an `export` event type for later billing.
- The delivered URL lives in `ai_jobs.payload.result_url` (no dedicated column),
  matching the spec's convention; the GET route reads it back after Realtime
  signals done.

## Amendments

### 2026-07-27 — facts leave the PDF; the page geometry is bounded

An audit of the shipped v1 found two things this ADR got wrong.

**Facts are no longer rendered, and the `include.facts` flag is removed.** §4
listed facts as one of four configurable blocks. But `analyze` only ever writes
`status='likely'` (EXIF-derived) or `'needs_check'` (AI-visual), and nothing
writes `'confirmed'` automatically — so on any asset the user has not hand-reviewed,
*every* fact is an unreviewed model guess. The handler selected them with no status
predicate and drew all three states as byte-identical grey bullets. That made the
export a larger laundering surface than the caption prompt, which
`handlers/caption.ts` deliberately restricts to `status = 'confirmed'` for exactly
this reason (see ARCHITECTURE.md's Facts entry: confirming is an AI action, not
bookkeeping). A document that leaves the building must not assert the model's
guesses in the same visual register as facts a human verified. Facts belong in the
captions CSV instead, where they can carry their status as a column and a machine
consumer can filter. `artboardSettingsSchema` is not `.strict()`, so settings rows
persisted with a `facts` key still parse — the key is stripped.

**The page geometry is now a bounded pure function.** `imgAreaH` was
`pageH - MARGIN*2 - textH - 16` with no floor. `textH` summed unbounded wrapped
line counts, so a long enough text block drove it negative; `Math.min` then picked
the negative ratio and `page.drawImage` received negative width *and* height.
pdf-lib does not validate the sign, so the photo rendered point-reflected as a
sliver hanging off the top of the page, overlapping the text — and the handler
still reported "Export ready". Dropping facts removes the most reachable path to
it (facts were selected with no `LIMIT`, where the caption prompt uses `limit 6`),
but one long caption reaches it too. So `planPhotoPage()` and `fitScale()` are now
exported pure functions, unit-tested in `export-logic.test.ts`, that reserve
`MIN_IMG_H` for the photo and truncate the caption with an ellipsis rather than
letting text consume the page; `fitScale` can no longer return a negative scale.
`wrap()` also hard-breaks a single token wider than the column, which previously
drew past the margin.

### 2026-07-27 — the `grid` layout honours every toggle it is offered

§4 defined `grid` as "2-up with a short caption" and then said what goes under
each photo is configurable. Both were shipped, and they contradicted each other:
the grid branch drew only the image and the caption. `row.title` and the EXIF
line were read exclusively in the `one_per_page` branch, while the dialog
rendered all the chips with no reference to the selected layout — they lit up
when pressed and changed nothing. Since `include.title` defaults **true**, a user
who picked Grid and touched nothing silently lost the filename, which is the one
thing that makes a contact sheet referenceable: without it a client cannot say
"the third one on page 2" and the photographer cannot map the reply back to a
frame. AGENTS.md already enforces this rule for AI actions — a label must not
describe work the run will not do — and the same rule applies here.

The grid now draws a `<index> · <title>` line and a meta line, both single lines
ellipsized to the cell by the new pure `truncateToWidth()`, and the two-line
caption clamp goes through `clampLines()` so a cut caption ends in an ellipsis
instead of stopping mid-word. Rather than disabling chips per layout, both
layouts render all three blocks: no toggle is inert anywhere, so there is nothing
left to explain in the UI. The dialog's subtitle now lists the enabled blocks
instead of unconditionally promising "each with its caption underneath" — which
it said even with Caption switched off.
