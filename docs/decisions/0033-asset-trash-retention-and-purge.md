# 0033. Asset trash: 30-day retention, purge-keeps-tombstone, undo-first delete UX

Date: 2026-07-23

Status: Accepted

## Context

Projects got a full soft-delete lifecycle in ADR 0019 (Trash view, Restore,
30-day sweep). Photos never did. `DELETE /api/assets/[id]` flipped
`status='deleted'` and stopped:

- **No guardrail, no recovery.** Three triggers (tile hover-X, action-bar
  Delete, the Delete/Backspace key) fired instantly — no confirmation, no undo,
  no Trash view, no restore endpoint. The only way back was re-importing the
  identical cloud file (the dedup revive path, ADR 0032). ADR 0017 self-flagged
  the missing confirmation as "revisit if too easy to trigger by accident".
- **The promised purge never existed.** The route's comment (and TECH_SPEC §12)
  deferred "R2 derivative purge" to a background job, but no `purge` job type
  or handler was ever built. Deleted photos kept their originals, previews,
  edited previews, and every DB derivative forever — an unbounded storage leak
  and a data-erasure gap (the bytes, with their embedded GPS EXIF, stayed
  presign-able).
- **Two constraints boxed the design in.** (a) ADR 0032's dedup revival needs
  the soft-deleted asset ROW to survive: merging a re-upload into a
  hard-deleted asset is how photos used to silently vanish. (b) DB cascades
  sever the DB→R2 key mapping, so any hard delete that runs before R2 cleanup
  makes the orphans unreclaimable.

## Decision

**1. Photos get the same 30-day trash contract as projects, on their existing
enum.** New `assets.deleted_at` / `assets.purged_at` columns (migration
20260723000001); `status` stays the state machine. A `BEFORE UPDATE` trigger
stamps `deleted_at` on the transition into `'deleted'` and clears both stamps
on the way out — so every status writer (delete route, restore route, import
re-pick revive, ingest dedup revive) agrees without route-side bookkeeping, and
the web stays deployable ahead of the migration.

**2. Purge erases bytes but keeps a tombstone.** `sweep_deleted_assets()`
(worker-scheduled next to the project sweep, boot + 6 h) enqueues `purge` jobs
for trash past 30 days. The handler, per asset:

1. *Claim*: stamp `purged_at` iff still `status='deleted'` — a restore that
   raced the enqueue wins; once claimed, the restore route's `purged_at is
   null` guard blocks the reverse race.
2. *R2 first*: delete original(s), thumb/medium previews, edited previews
   **while the rows still map the keys**; a failure throws and the job retries
   with the mapping intact.
3. *Rows second*: previews/edits/tags/captions/facts/embeddings/EXIF rows go;
   `files.r2_key` and `files.content_hash` are nulled.

The assets row survives (`status='deleted'`, `purged_at` set) — ADR 0032's
revival semantics stay intact *within* the grace window (bytes still exist →
revive-merge), and *after* purge the cleared `content_hash` means the tombstone
simply never matches dedup again: re-uploading the same bytes ingests cleanly
as a fresh asset, and a cloud re-pick (matched by `source_file_id`, not hash)
revives + re-ingests through the existing `/api/imports` flow, which regenerates
previews from the source. Nothing merges into an empty shell.

**3. Undo-first delete UX, modal only where it earns its keep.** Culling a
photo archive is a bulk activity; a modal per delete would be punitive.
So: any delete is optimistic and shows a *"Moved to Trash — Undo"* toast
(bulk `POST /api/assets/delete`, undo = bulk `POST /api/assets/restore`);
selections ≥ 8 (`BULK_DELETE_CONFIRM_AT`) confirm first in the same
ConfirmModal projects use; **permanent** deletion (Trash view's "Delete
permanently" / "Empty trash" → `POST /api/assets/purge`) always confirms, even
for one photo — it is the only truly irreversible action in the app. Delete is
now also reachable from the drawer and the right-click menu; the action bar's
misleading "Archive — coming soon" stub is gone.

**4. The Trash view shows both halves.** The homepage Trash lists trashed
projects (as before, now with an "N days left" countdown from `deleted_at`)
plus a Photos section (`GET /api/assets?scope=trash`): thumb, countdown,
Restore, Delete permanently, Empty trash. Purged tombstones are excluded —
nothing restorable, nothing shown.

**5. Edit-reset cleans up its own orphans inline.** `DELETE
/api/assets/[id]/edit` now best-effort-deletes the two edited webp objects it
just orphaned (their keys are only known in that request); ADR 0030 had
deferred this to "a later purge" that would never see resets on assets that
are never deleted.

## Consequences

- The storage leak closes for every asset that goes through the trash; the UI's
  "permanently removed after 30 days" copy is now true for photos and their
  bytes, not just project rows. Erasure of the *bytes* (incl. GPS EXIF) is what
  GDPR-aware §12 needed most.
- `deleted` is no longer terminal-but-fake: restore is first-class, and the
  enum's meaning ("in the trash, clock running") finally matches the UI.
- A permanently failed purge job (3 retries) leaves a claimed tombstone whose
  derivatives survive until manual re-enqueue — visible as a failed `ai_jobs`
  row, honest rather than silent. Accepted for MVP.
- Purge deletes AI derivatives (captions/tags/embeddings), so a purged photo's
  knowledge is gone even though the row isn't. `source_missing` is untouched —
  its keep-the-derivatives contract (§12) still holds.
- Workspace-level right-to-erasure ("delete my account and everything") is
  explicitly **out of scope** here — tracked for Phase 7 hardening so it
  doesn't get lost; the purge handler is the building block it will reuse.
- Copy discipline: tile/bar/menu deletes say "Move to Trash"; only the Trash
  view says "Delete permanently". The two must never swap.
