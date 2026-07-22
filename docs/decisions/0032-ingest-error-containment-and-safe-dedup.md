# 0032. Ingest error containment, status-and-durability-aware dedup, and honest job status

Date: 2026-07-22

Status: Accepted

## Context

An audit of the ingest handler (`apps/worker/src/handlers/ingest.ts`) found four
failure modes in the per-asset loop (issues #116–#119). Fixing them forced a
handful of behavioural calls the other maintainer would reasonably want to weigh
in on — this ADR records the *why*, because the code comments alone don't make
the alternatives (and why we rejected them) visible.

The forces in play, and the invariants a fix must not break:

- **Assets are M:N to projects** (ADR 0011). A deduped copy's project links must
  survive onto whatever record wins.
- **Drive-linked files never store an original in R2** (ADR 0025 / TECH_SPEC §6):
  `files.r2_key` is null for `origin='gdrive'`; only the webp previews live in
  R2. Uploads and Dropbox *do* have a durable R2 original.
- **`files_dedup_idx` is `UNIQUE (workspace_id, content_hash) WHERE content_hash
  IS NOT NULL`** — at most one file per distinct content per workspace. A second
  live file cannot hold a hash the survivor still owns; something has to give.
- **`source_missing` is set only in the Drive branch** — so a `source_missing`
  asset is always a Drive row whose upstream source is gone: it has no
  retrievable original anywhere.
- **The `/api/imports` route already reactivates soft-deleted / `source_missing`
  assets on re-pick** (PLAN.md, ADR 0025). The worker-side dedup had drifted out
  of step with that intent.

The four bugs:

1. **#116 — no per-asset error containment.** The R2 fetch, the `asset_exif`
   upsert, and decode/preview generation were unguarded. Any throw (an
   undecodable HEIC, a truncated/mislabelled JPEG — the MIME is client-supplied
   and never sniffed — a missing R2 object, a transient DB fault) escaped the
   loop *and* the handler, abandoning every file after it. Only the cloud
   *download* branches were contained; the asymmetry was the tell.
2. **#117 — zero-byte dedup black hole.** An empty buffer hashes to the
   well-known `sha256("")` constant. Written into `content_hash`, the first
   0-byte file became a dedup attractor that merged-and-deleted every later empty
   file (its asset + R2 original).
3. **#118 — dedup blind to `assets.status` and to byte durability.**
   Re-uploading a soft-deleted photo merged the fresh copy *into* the tombstone
   (deleting the re-added asset — the user saw success and the photo never came
   back). Separately, the merge deleted the incoming *durable* R2 original
   without checking the survivor had any retrievable bytes — so an upload
   deduped against a byte-less Drive survivor destroyed the only recoverable copy
   the user just supplied and left an active-but-unrenderable record.
4. **#119 — dishonest job status.** Every per-asset failure only incremented a
   local counter, so a job in which *every* asset failed still returned normally
   → `completeJob` wrote `status='done', error=null`. Indistinguishable from a
   flawless run — the exact mechanism that hid the iPhone HEIC bug (#113).

## Decision

**Contain every per-asset I/O stage.** R2 fetch, the EXIF upsert, and
decode/previews are each wrapped: a failure marks *that* asset (`failed += 1`),
logs a **first-party code** (`ingest_bytes_missing` / `ingest_exif_failed` /
`ingest_decode_failed` / `ingest_dedup_failed` — never a raw sharp/AWS/pg string,
same contract as the Drive/Dropbox codes), and `continue`s. EXIF is best-effort:
a failure there skips the metadata but still generates previews.

**Refuse empty buffers before hashing** (#117) — a 0-byte file never reaches the
dedup index.

**Dedup is status- and durability-aware** (#118), expressed as a pure,
unit-tested decision — `dedupDecision(survivorStatus, survivorDurable,
incomingDurable)`:

- `source_missing` survivor → **stand-alone**. Never fold a fresh copy into a
  permanently broken record.
- incoming is durable (R2 original) but the survivor is **not** → **stand-alone**.
  Never trade the user's only recoverable copy for a byte-less survivor.
- otherwise → **merge** into the survivor, **reviving** it first if it was
  soft-deleted ("I re-uploaded it to get it back"). Active duplicates merge
  exactly as before; project links always move to the survivor first (ADR 0011).

"Stand-alone" means: release the survivor's claim on the hash
(`content_hash = null`, exempt from the partial UNIQUE index) and let the
incoming file take the hash and stand as its own active asset. We accept a rare
**duplicate** over silent data loss.

**A decode/preview failure also clears the (already-written) `content_hash`,** so
the broken preview-less shell stops being a valid dedup survivor — otherwise a
user re-uploading to fix it would be merged into the shell and heal nothing.

**Job status tells the truth** (#119): an all-failed run `throw`s
`ingest_all_failed` so the job is `failed`; partial failures stay `done` but
carry the counts in `progress_label`, surfaced by a web toast (including
wholly-failed *cloud* imports, which create no preview tiles to show a per-tile
error). `source_missing` is a handled-terminal outcome — counted separately as
`missing` (shown, but not driving `isWhollyFailed`) so an all-gone batch isn't
retried three times against a permanent condition, matching `drive_file_too_large`.

## Consequences

- **No single bad file can abandon a batch, and no dedup path can silently
  destroy the user's durable original or resurrect a broken record.** The
  data-loss and silent-success holes are closed.
- **Recovery is honest:** failures are counted and surfaced; an incomplete asset
  (no `content_hash`) is re-importable and heals on re-ingest (the #113 heal
  path via the resume guard).
- **We accept a rare visible duplicate** in the stand-alone case (a durable
  upload of content that also exists as a byte-less Drive link) rather than
  destroy bytes. Merging the *other* direction (fold the survivor's metadata into
  the fresh asset) would avoid the duplicate but means transferring
  captions/facts/tags/EXIF/cluster/project links — deferred as too much surface
  for a bug fix.
- **Containment traded away job-level auto-retry for partial batches:** a
  transient single-asset fault (R2 5xx, DB blip) that would once have retried the
  whole job is now a contained per-asset failure the user re-imports. The AWS SDK
  still retries transient 5xx internally; brief blips are absorbed below the
  catch. Judged the right trade — batch resilience over opaque whole-job retries.
- **No schema change.** The code fix fully closes the holes. A defensive
  `check (byte_size > 0)` on `files` (suggested in #117) is left as an optional
  owner-only migration.
- **Known gap, tracked separately:** an import in which *every* file lands
  `kind='other'` (over the size limit / undecodable) still shows no toast — those
  are kept-but-degraded, not failures. Low severity, pre-existing.

Related: ADR 0008 (Dropbox originals in R2), ADR 0011 (Asset ≠ File), ADR 0025
(Drive originals never in R2).
