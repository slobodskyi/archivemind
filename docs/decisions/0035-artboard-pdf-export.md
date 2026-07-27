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

### 2026-07-27 — metered, bounded, and no longer silent about skipped photos

Export was the only job type writing no `usage_events` row, though the schema has
reserved the `export` event type since init and the Consequences above claim it is
carried for billing. It is also the most expensive non-AI operation per
invocation — N R2 GETs, N sharp transcodes, and a stored artifact — so the page
count is now recorded, which is what makes the R2 growth attributable to a
workspace after the fact.

`POST /api/exports` had no rate limit and no in-flight check. The worker claims and
awaits ONE job at a time across all workspaces with no per-type lanes, so a retry
loop could queue hundreds of 500-page exports and starve every ingest, analyze and
purge job in the deployment — for every user. `EXPORT_MAX_IN_FLIGHT` mirrors the
ingest backlog guard already in `POST /api/imports`. The 500-page cap also now
applies to the `group_id` branch, whose query had no `LIMIT` at all: the ceiling
was enforced in exactly one of the two paths.

And a photo with no usable preview no longer disappears quietly. `embedMedium`
swallowed both misses (a bare `catch { return null }`, and no `console` call
anywhere in the file, against 13 in `ingest.ts`), then drew an anonymous grey box
and reported "Export ready". Both paths are logged, the placeholder names the
file, the count lands in `payload.skipped_previews` and in the final progress
label. Worth stressing that the common case is not an error at all: an asset is
`status='active'` the moment the upload completes, so exporting before ingest has
run is an ordinary thing to do, and the dialog's pre-flight now says so too.

### 2026-07-27 — purge erases the deliverables too, not just the asset

The sweep above bounded a purged photo's survival inside past exports to
`EXPORT_RETENTION_DAYS`. For a "Delete permanently" click — and for the GDPR
right-to-erasure work in #134 — eventual is not the promise. `purge.ts` now
deletes every export artifact containing the asset, in the same R2 phase as its
own bytes.

The hard part was the mapping, and it is solved in the export job rather than
guessed at in the purge. `finishExport` writes **`payload.exported_asset_ids`** —
the set actually rendered into that artifact. The request payload alone cannot
answer the question: a `group_id` export carries no asset list at all, and group
membership can change after the render, so a join through
`canvas_group_assets` would be reconstructing a past state from a present one.
`payload.asset_ids` is still matched so artifacts written before this field
existed are covered; that is the *requested* set, a superset of the rendered one,
which errs in the right direction here — the user just permanently deleted the
photo, so removing a deliverable that may contain it is the intent.

**The cleanup is contained, not fatal.** A throw would be worse than the risk it
guards: by that point the asset's own bytes are already deleted, so one
persistently failing artifact (a malformed key) would block the derivative-row
cleanup forever, leaving the tombstone holding its dedup claim and its captions,
facts and EXIF for good. It logs and moves on; `sweepExpiredExports` remains the
backstop. ADR 0033's ordered correctness argument gains this as step 3 rather
than having it smuggled in.

### 2026-07-27 — it reads as a document now: cover, footer, metadata, filename

`drawText` appeared exactly **once** in the whole worker before this — inside
`drawLines`. So a 60-page client PDF had no page numbers and was literally
uncitable: nobody could say "the third one on page 7". `doc.setTitle` was never
called either (pdf-lib sets Producer/Creator to its own URL string and a
CreationDate, so the timestamp existed but was never rendered), and the download
saved as the job's uuid.

Four additions:

- **Metadata** — `setTitle` from the new `title` field on the export request,
  `setAuthor` from `workspaces.creator`, `setSubject` from the copyright notice.
  The title is client-supplied because the route resolves a `project_id` only in
  the `groupId` branch, which no client reaches; the dialog prefills it with the
  current project's label and lets the user edit it.
- **A footer on every page** — `i / n` right-aligned, the credit line
  left-aligned, at `FOOTER_Y` inside the bottom margin so it never collides with
  the content box.
- **An optional cover page** (`options.cover`, default **false** — an extra page
  nobody asked for is a surprise): title, photo count, the date range from
  `min/max(asset_exif.taken_at)`, then the rights block. `coverLines()` is pure
  and tested, including the case where `creator` and `credit` say the same thing
  and should not print twice.
- **A human filename** — `ResponseContentDisposition` signed into the presigned
  URL by `presignGet(key, filename)`. It has to be signed in: the `download`
  attribute on an `<a>` is ignored cross-origin and the presigned URL is on the R2
  host. `exportFilename()` lives in shared so the name cannot drift, and the
  header carries both an ASCII fallback and RFC 5987 `filename*` so a Cyrillic
  title survives. Passing a filename also opts out of the signing-date bucket,
  which exists to keep *preview* URLs byte-identical for the browser cache and has
  no bearing on a one-off deliverable.

The credit block itself is edited in the export dialog (migration
`20260727000001`): the app has no settings page, and this is the only place a
byline matters. A non-owner sees the values read-only, because
`workspaces_update` is `is_owner`.

### 2026-07-27 — the ZIP bundle: "pick some files, get a zip"

The simplest thing a user expects of an archive tool, and the last piece of
TECH_SPEC §8.5 that had never been built. `format: 'zip'`, with
`zipContents: 'originals' | 'web'`:

- **originals** — the real file for every source that HAS one in R2. A
  Drive-linked asset does not: ADR 0025 streams Drive bytes at processing time and
  never stores them, so those fall back to their 1024px preview, are renamed
  `.webp` (shipping preview bytes under a `.NEF` name would be a lie), and are
  **named individually in a README.txt** inside the archive. That is precisely
  what §8.5 prescribed — "owned original files where present, else medium previews
  + note" — and it beats both alternatives: silently passing a preview off as an
  original, or failing the whole bundle because one photo came from Drive.
- **web** — the previews for everything: ~100–300 KB each, so 500 photos land
  around 50–150 MB and the bundle can actually be emailed.

`captions.csv` rides inside either shape, so the metadata travels with the pixels
and the recipient needs nothing from us to read it.

**No zip dependency.** The monorepo had none, and the candidates (`yazl`,
`archiver`) buy deflate we do not want: every payload is a JPEG, HEIC, webp or RAW,
already entropy-coded, so compressing costs real CPU for ~0–2%. `services/zip.ts`
is a ~120-line STORE-only writer whose one non-trivial piece — CRC-32 — is
`node:zlib`'s, new in Node 22. STORE also keeps the format trivially correct: sizes
and CRCs are known before each header is written, so there are no data descriptors.
It is deliberately **not** Zip64, and both non-Zip64 limits (4 GiB, 65535 entries)
**throw** rather than silently emitting a truncated archive.

**The size guard is the load-bearing part.** `putObject` takes a Buffer and there
is no multipart upload anywhere in the repo, so the archive is fully in memory. A
RAW bundle would OOM — and an OOM is a SIGKILL, which skips the handler's catch
entirely, so `failOrRetryJob` never runs, `MAX_ATTEMPTS` never applies, and
`reapStaleJobs` requeues the poison job every ~15 minutes forever, taking the
single-threaded worker down each cycle. So `planZip` sums `files.byte_size`
**before fetching a single object** and throws `export_too_large` above
`ZIP_MAX_TOTAL_BYTES`. A refusal the user can act on beats a crash loop.
Streaming multipart would raise the ceiling later; it is not needed to make this
safe.

### 2026-07-27 — captions.csv: the ZIP+CSV half of §8.5 was not a subset after all

The Consequences above call this ADR "a **superset** of TECH_SPEC §8.5". For the
laid-out document that is true; for the caption sidecar it is not. **A PDF is not a
superset of a spreadsheet** — you cannot paste a PDF page into an agency's caption
field, feed it to a CMS import, or hand it to a translator as a worklist. Until now
the only way to get generated captions out of ArchiveMind was the drawer's Copy
button, one caption at a time: exactly the manual labour the product exists to
remove.

`format` is added to `artboardSettingsSchema` as a **flat** enum, not a
discriminated union: three live call sites parse a maybe-`{}` settings blob
(`canvas_groups.settings`), and a union would reject every one of them. Every field
defaults, so rows written before formats existed parse as `pdf`. No migration —
`format` lives in jsonb and `'export'` has been in the `job_type` enum since init.

The handler splits into `collectExportRows()` (format-agnostic, the ordered rows)
plus a per-format renderer plus a shared `finishExport()` storage tail, and
`EXPORT_ARTIFACTS` replaces the hardcoded `.pdf` / `application/pdf`.

Two decisions inside the CSV worth recording:

- **Facts are split into `facts_confirmed` and `facts_unreviewed`,** not filtered and
  not merged. This is the other half of taking them out of the PDF: a machine
  consumer *should* see the model's guesses, as long as the file says which they are.
- **Caption columns use an exact (lang, style) lookup, deliberately not
  `resolveCaptionText`.** Its fallback chain is right for a page that needs *some*
  text under the photo and wrong for a column labelled `caption_uk`, which would
  then hold English. An empty cell is the useful answer — it is precisely the list of
  photos still needing Ukrainian.

The CSV also carries what the PDF never did: tags (which §8.5 asked for), the AI
description from `embeddings.content`, and the full EXIF the PDF only ever summarised
into one line.

### 2026-07-27 — the artifact is keyed, presigned per request, and swept

Decision §1 stored a **7-day presigned URL** in `ai_jobs.payload.result_url`.
That was wrong twice over.

*Exposure.* `ai_jobs` RLS is `is_member(workspace_id)` with no column
restriction, and the `payload` UPDATE fires the Realtime broadcast trigger. So a
bearer URL — which bypasses RLS entirely for anyone holding it — was readable by
every member of the workspace, viewers included, and pushed to all of them on
completion.

*Rot.* From day 8 the stored signature was dead, while `GET /api/exports`
happily returned it alongside `status: "done"`. There was no re-presign path,
even though the key is deterministic.

The worker now writes only `payload.result_key`, and the GET route presigns it
per request for the caller who is entitled to it. `EXPORT_PRESIGN_TTL_SECONDS`
is replaced by `EXPORT_RETENTION_DAYS`: the policy is the **artifact's** lifetime,
not a URL's, and a download link is always freshly minted.

That lifetime is now enforced. Nothing had ever deleted an export: `retention.ts`
had two sweeps that touch R2 not at all, `purge.ts` collects keys only from
`files` / `asset_previews` / `asset_edits`, and there is no bucket lifecycle rule
in the repo. Since the key derives from the **job** id, every re-export minted
another object, so ten iterations left ten PDFs — all unreachable the moment the
job id was forgotten. TECH_SPEC §8.5 wrote "(presigned GET, cleanup later)";
`sweepExpiredExports` on the existing 6-hourly tick is later. It clears the key
per row after the delete succeeds, so a mid-sweep failure retries rather than
orphaning objects whose keys it had already dropped.

One consequence worth naming: an exported PDF embeds a JPEG copy of each photo,
so a purged asset's pixels survive inside any export made from it. This sweep
bounds that window to `EXPORT_RETENTION_DAYS`; **the same-day amendment below
makes it immediate.**

Finally, a finished export can no longer strand: the Realtime handler has an
`export` branch that raises a toast with a Download action when the job completes
and the dialog is gone. The broadcast is workspace-scoped, so this survives the
reload that used to lose the only copy of the job id.

### 2026-07-27 — the dialog reports the run before and during it

Three contract additions, all backward-compatible. `exportResultSchema` now
carries `progress` / `progressLabel` / `doneItems` / `totalItems`: the worker has
always written a true percentage and a `Rendering i/total` label on every photo,
but `GET /api/exports` selected only `id, status, payload`, so the dialog showed
a hardcoded, frozen 40% bar for every job of every size — indistinguishable from
a dead worker. `POST /api/exports` now answers with a machine-readable code from
`EXPORT_ERROR_CODES` instead of prose, because every distinct failure (over the
cap, photos in Trash, expired session) collapsed into one line of generic copy;
unknown codes still fall back to it, so adding a code is never breaking. And the
500 cap is now the single `EXPORT_MAX_ASSETS` constant shared by the request
schema, the payload schema and the dialog copy — it was three unexplained
literals, and a selection over it produced a bare 400.

The dialog is also a real modal now (`useDialog`, matching Confirm/Rename/Help)
at `Z.modal` rather than `Z.menu`, and `exportOpen` short-circuits the global
Delete/Escape/Space handlers — Backspace with the dialog open used to move the
very photos being exported to Trash, after which the route 404'd with copy that
gave no hint the keypress had done it. While a render is in flight the dialog is
deliberately not dismissible: it is currently the only place the finished link
appears. A stall deadline (no status change for 5 min) turns the previously
unbounded poll into an actionable error, so that is never a trap.

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
