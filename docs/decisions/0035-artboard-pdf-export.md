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
