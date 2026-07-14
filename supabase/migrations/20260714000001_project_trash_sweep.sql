-- Project trash retention — follow-up to 20260713000001, which added
-- projects.archived_at/deleted_at but deliberately left the sweep out ("a
-- future scheduled job, not part of this migration"). The UI already promises
-- the user "permanently removed after 30 days" (HomeClient Trash copy), so
-- something has to enforce it: sweep_trashed_projects() is that something,
-- scheduled by the worker next to the stale-job reaper (apps/worker/src/
-- retention.ts). Not pg_cron — the worker already owns periodic maintenance
-- (TECH_SPEC §7) and a new extension would diverge local from prod.
-- Rationale: docs/decisions/0019-project-archive-trash-retention.md

-- Every homepage load filters projects on both soft-state columns. 0001's
-- convention is to index each workspace-scoped query path, partial where the
-- query is partial (cf. ai_jobs_queue_idx ... where status = 'queued').
create index projects_ws_active_idx on projects (workspace_id)
  where archived_at is null and deleted_at is null;

-- Hard-delete projects whose trash grace period has expired. project_assets
-- rows cascade (0001); the assets themselves are workspace-global and SURVIVE
-- — a project is an M:N curated subset, not a container (TECH_SPEC §3 rule 9),
-- so this never touches R2. Returns the number of projects removed.
--
-- security INVOKER on purpose (unlike 0001's RLS helpers, which need definer
-- to break policy recursion): the worker connects as `postgres` and bypasses
-- RLS, so it sweeps everything, while any authenticated caller stays scoped by
-- projects_delete (is_editor) to their own workspace. Definer here would let
-- any logged-in user purge every tenant's trash.
create function sweep_trashed_projects(retention interval default interval '30 days')
returns integer
language plpgsql
set search_path = public
as $$
declare
  removed integer;
begin
  delete from projects
   where deleted_at is not null
     and deleted_at < now() - retention;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function sweep_trashed_projects(interval) is
  'Hard-deletes trashed projects past the retention window (default 30 days, '
  'matching the Trash copy in HomeClient). Scheduled by apps/worker; assets are '
  'workspace-global and are never touched. See ADR 0019.';
