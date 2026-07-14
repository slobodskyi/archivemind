# 0019 — Project archive/trash: timestamp soft-state + worker-scheduled 30-day sweep

Status: accepted (2026-07-14) · Issue: #26 (partial) · Follows: #74

## Context

PR #74 added Archived and Trash surfaces to the homepage, backed by migration
`20260713000001` (`projects.archived_at` / `projects.deleted_at`) and
`PATCH /api/projects/[id]`. A post-merge audit surfaced four gaps, none of them
in the migration's SQL — all in what surrounded it:

1. **The UI promised something nothing implemented.** `HomeClient` tells the
   user, twice, that trashed projects are *"permanently removed after 30 days"*.
   No sweep existed; `20260713000001`'s own comment defers it to "a future
   scheduled job". `deleted_at` was a permanent tombstone. TECH_SPEC §12 commits
   us to a GDPR-aware posture before the first external user — promising deletion
   and not deleting is the wrong direction to be wrong in.
2. **Archive/trash is not in TECH_SPEC.** v1.2 is "approved for build" and
   canonical for the domain model; its `projects` table has neither column, and
   its §12 deletion policy covers assets only. ADRs 0016–0018 (shipped in the
   same PR) document the *views*, not the schema — so a new domain concept
   entered the canonical model undocumented.
3. **Two soft-delete idioms now coexist.** Assets use the spec-pinned
   `asset_status` enum (`active | source_missing | deleted`); projects use two
   nullable timestamps. Nothing recorded why.
4. **No index, no test.** `getProjectCards` filters both columns on every
   homepage load, while 0001 indexes every workspace-scoped query path — and
   the pgTAP suite that ADR 0013 established *specifically as the migration gate*
   had zero coverage of the new columns. CI was green because the old tests
   still passed, not because the new ones existed.

## Decision

**Timestamps, not a status enum, for projects.** A 30-day grace period needs to
know *when* a project was trashed; an enum cannot express that. Two nullable
timestamps also keep archive and trash orthogonal — a project can be archived,
trashed, or both, and `archived_at is null` / `deleted_at is null` are the
natural queries. Assets keep their enum: they have no grace window and their
`source_missing` state has no timestamp meaning. The divergence is intentional.

**The sweep lives in a SQL function, scheduled by the worker.** Migration
`20260714000001` adds `sweep_trashed_projects(retention interval default 30 days)`
plus the partial index `projects_ws_active_idx`. `apps/worker` calls it on boot
and every 6 h, next to the existing stale-job reaper.

Rejected: **pg_cron**. It would mean a new extension (only `vector` is enabled
today), a scheduling mechanism TECH_SPEC never mentions, and a fresh way for
local to diverge from prod — to solve a problem the worker already has a shipped
pattern for (`REAPER_EVERY_MS`, TECH_SPEC §7). Rejected: **a new `ai_jobs` type**.
`job_type` is a spec-pinned enum (`ingest | analyze | caption | export`) for
user-triggered work; a retention sweep is neither user-triggered nor per-asset.

**Sweeping a project never touches its assets.** Assets are workspace-global and
a project is an M:N curated subset, not a container (TECH_SPEC §3 rule 9), so the
sweep deletes the project row, `project_assets` cascades, and R2 is not involved.
This makes the UI copy accurate as written: the *project* is removed, the photos
stay in the archive.

**`security invoker`, deliberately.** 0001's RLS helpers are `security definer`
to break policy recursion; copying that here would let any authenticated user
purge every tenant's trash. As invoker, the worker (connecting as `postgres`)
bypasses RLS and sweeps everything, while any other caller stays scoped by
`projects_delete = is_editor` to their own workspace.

## Consequences

- The 30-day promise is now enforced, and `supabase/tests/002_retention.sql`
  pins it: 31 days goes, 29 days stays, archived-but-not-trashed stays at any
  age, and the swept project's asset survives. The window lives in the SQL
  default — one source of truth, and the test exercises the real default rather
  than a copy of it.
- Retention stops if the worker stops. Acceptable for a 30-day window (a missed
  sweep is a late delete, not a wrong one), and the reaper already has exactly
  this property. If retention ever needs to hold with the worker down, pg_cron
  is the escape hatch and this ADR is what to revisit.
- `sweep_trashed_projects` runs unfiltered by workspace: it is a global sweep,
  correct only because the caller is trusted. Any future API exposure must keep
  it invoker-scoped.
- TECH_SPEC §4 (`projects`) and §12 (deletion) are updated in the same PR, so the
  spec stays the single source of truth rather than trailing the schema.
- Archived projects are currently unopenable by URL — `/projects/[id]` loads the
  active list and redirects anything else home. That falls out of the guard
  rather than from a decision; if archived-but-readable is wanted, it is a
  separate change.
