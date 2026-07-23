-- Asset trash retention (ADR 0033) — the photo half of what 20260713000001 /
-- 20260714000001 gave projects. assets already had the soft state (asset_status
-- 'deleted', flipped by DELETE /api/assets/[id]) but no clock and no
-- reclamation: the "R2 derivative purge background job" the route's comment
-- promised never existed, so deleted photos kept their DB derivatives and R2
-- bytes forever. This migration adds the clock (deleted_at), the terminal
-- marker (purged_at) and the sweep that enqueues 'purge' worker jobs; the
-- worker handler (apps/worker/src/handlers/purge.ts) does the actual R2 +
-- derivative deletion, keeping the asset row itself as a lightweight tombstone
-- (dedup reactivation depends on the row existing — ADR 0032).

-- The worker renders purges as a queue job. Append to the job_type enum; the
-- value is NOT used elsewhere in this migration's executed statements (the
-- sweep function body below is only parsed at call time), so it is safe inside
-- a transaction — same pattern as 'cluster' (20260722000001) and 'edit'
-- (20260722000003).
alter type job_type add value if not exists 'purge';

alter table assets
  add column deleted_at timestamptz,
  add column purged_at timestamptz;

comment on column assets.deleted_at is
  'When the asset entered the trash (status=''deleted''). Stamped by trigger, '
  'drives the 30-day sweep. Null while active/source_missing.';
comment on column assets.purged_at is
  'When the purge job erased the R2 bytes + DB derivatives. The row survives '
  'as a dedup tombstone (ADR 0032/0033); purged rows leave the Trash view and '
  'can no longer be restored.';

-- Existing trash entered before this migration has no recorded time — start
-- its 30-day window now rather than guessing (deleting it immediately would
-- break the "30 days to change your mind" promise retroactively).
update assets set deleted_at = now() where status = 'deleted' and deleted_at is null;

-- Stamp the clock in the DB, not in route code, so EVERY status writer agrees:
-- the delete route, the restore route, the import re-pick revive and the ingest
-- dedup revive all just write `status` and the timestamps follow. (Also keeps
-- the web deployable ahead of this migration — it never writes the new
-- columns.) Leaving trash clears BOTH stamps: a purged_at surviving a revival
-- would silently exempt the asset from every future sweep.
create function public.stamp_asset_deleted_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'deleted' and old.status is distinct from 'deleted' then
    new.deleted_at := now();
  elsif new.status <> 'deleted' and old.status = 'deleted' then
    new.deleted_at := null;
    new.purged_at := null;
  end if;
  return new;
end $$;

-- BEFORE triggers fire alphabetically: assets_stamp_deleted_at runs ahead of
-- assets_updated_at (init.sql) — independent columns, either order is fine.
create trigger assets_stamp_deleted_at before update on assets
  for each row execute function stamp_asset_deleted_at();

-- One index serves both consumers, partial per 0001's convention: the Trash
-- view lists a workspace's un-purged trash newest-first, and the sweep scans
-- the same (tiny) predicate for expired rows.
create index assets_trash_idx on assets (workspace_id, deleted_at desc)
  where status = 'deleted' and purged_at is null;

-- Enqueue purge jobs for trash past its grace period — one job per workspace
-- per run, payload {asset_ids:[...]} (mirrors ingest's shape). The sweep only
-- ENQUEUES; the worker's purge handler deletes R2 objects first and derivative
-- rows second, then stamps purged_at (so a crashed purge is re-runnable and a
-- restore that raced the sweep wins — the handler re-checks status).
--
-- security INVOKER on purpose, exactly like sweep_trashed_projects
-- (20260714000001): the worker connects as `postgres` and sweeps every
-- workspace; any authenticated caller stays scoped by RLS (assets_select →
-- is_member for the scan, ai_jobs_insert → is_editor for the enqueue) to
-- workspaces they could purge anyway. Returns the number of assets enqueued.
create function sweep_deleted_assets(retention interval default interval '30 days')
returns integer
language plpgsql
set search_path = public
as $$
declare
  enqueued integer;
begin
  with expired as (
    select a.id, a.workspace_id
      from assets a
     where a.status = 'deleted'
       and a.purged_at is null
       and a.deleted_at is not null
       and a.deleted_at < now() - retention
       -- an asset already riding a live purge job must not be double-enqueued
       -- (sweeps run every 6 h; a failed job's retries can outlive one cycle)
       and not exists (
         select 1 from ai_jobs j
          where j.workspace_id = a.workspace_id
            and j.type = 'purge'
            and j.status in ('queued', 'running')
            and j.payload->'asset_ids' ? a.id::text
       )
  ), jobs as (
    insert into ai_jobs (workspace_id, type, payload, total_items, done_items)
    select workspace_id, 'purge',
           jsonb_build_object('asset_ids', jsonb_agg(id order by id)),
           count(*)::int, 0
      from expired
     group by workspace_id
    returning total_items
  )
  select coalesce(sum(total_items), 0)::int into enqueued from jobs;
  return enqueued;
end;
$$;

comment on function sweep_deleted_assets(interval) is
  'Enqueues ''purge'' worker jobs for trashed assets past the retention window '
  '(default 30 days, matching the Trash copy). Scheduled by apps/worker next '
  'to sweep_trashed_projects; the handler erases R2 bytes + DB derivatives and '
  'stamps purged_at, keeping the asset row as a dedup tombstone. See ADR 0033.';
