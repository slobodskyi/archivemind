-- Asset trash retention suite (pgTAP) — run: `supabase test db`
-- Covers migration 20260723000001: the deleted_at/purged_at trigger stamps and
-- sweep_deleted_assets() — the grace window, the purge-job payload, what must
-- NOT be enqueued, and idempotence across consecutive sweeps (ADR 0033).
--
-- Mirrors 002_retention.sql: fixtures set deleted_at in the past and call the
-- function directly rather than waiting on the worker's schedule. INSERTs
-- bypass the stamp trigger (it is BEFORE UPDATE only) — deliberate, that is
-- what lets these fixtures exist.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ── fixtures (as superuser; RLS is 001's job, not this suite's) ──────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f5', 'f@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000f5', 'F');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000ffff', 'WS-F', '00000000-0000-0000-0000-0000000000f5');
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ffff', '00000000-0000-0000-0000-0000000000f5', 'owner');

insert into public.assets (id, workspace_id, kind, title, status, deleted_at, purged_at) values
  -- expired trash → must be enqueued for purge
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-00000000ffff',
   'photo', 'expired',  'deleted', now() - interval '31 days', null),
  -- still inside the window → must stay untouched
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-00000000ffff',
   'photo', 'recent',   'deleted', now() - interval '29 days', null),
  -- already purged → a tombstone, never re-enqueued
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-00000000ffff',
   'photo', 'purged',   'deleted', now() - interval '40 days', now() - interval '9 days'),
  -- plain active → must never be touched
  ('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-00000000ffff',
   'photo', 'active',   'active',  null, null);

-- ── trigger: the clock is stamped in the DB, not in route code ──────────
update public.assets set status = 'deleted'
 where id = '00000000-0000-0000-0000-000000000a04';
select isnt(
  (select deleted_at from public.assets where id = '00000000-0000-0000-0000-000000000a04'),
  null::timestamptz,
  'flipping status to deleted stamps deleted_at');

update public.assets set purged_at = now()
 where id = '00000000-0000-0000-0000-000000000a04';
update public.assets set status = 'active'
 where id = '00000000-0000-0000-0000-000000000a04';
select is(
  (select deleted_at from public.assets where id = '00000000-0000-0000-0000-000000000a04'),
  null::timestamptz,
  'leaving trash clears deleted_at');
select is(
  (select purged_at from public.assets where id = '00000000-0000-0000-0000-000000000a04'),
  null::timestamptz,
  'leaving trash clears purged_at too — a stale stamp must not exempt the next life from sweeps');

-- ── the sweep ───────────────────────────────────────────────────────────
select is(
  (select public.sweep_deleted_assets()), 1,
  'sweep enqueues exactly the one asset past the 30-day window');

select is(
  (select count(*)::int from public.ai_jobs
    where workspace_id = '00000000-0000-0000-0000-00000000ffff' and type = 'purge'),
  1,
  'one purge job per workspace per run');

select is(
  (select status::text from public.ai_jobs
    where workspace_id = '00000000-0000-0000-0000-00000000ffff' and type = 'purge'),
  'queued',
  'the purge job is enqueued for the worker, not executed by the sweep');

select ok(
  (select payload->'asset_ids' ? '00000000-0000-0000-0000-000000000a01'
     from public.ai_jobs
    where workspace_id = '00000000-0000-0000-0000-00000000ffff' and type = 'purge'),
  'the expired asset rides in the job payload');

select ok(
  (select not (payload->'asset_ids' ? '00000000-0000-0000-0000-000000000a02')
     from public.ai_jobs
    where workspace_id = '00000000-0000-0000-0000-00000000ffff' and type = 'purge'),
  'trashed 29 days ago is NOT enqueued — grace window is respected, not approximated');

select ok(
  (select not (payload->'asset_ids' ? '00000000-0000-0000-0000-000000000a03')
     from public.ai_jobs
    where workspace_id = '00000000-0000-0000-0000-00000000ffff' and type = 'purge'),
  'an already-purged tombstone is never re-enqueued');

-- ── idempotence: the 6-hourly reschedule must not stack duplicate jobs ──
select is(
  (select public.sweep_deleted_assets()), 0,
  'a second sweep enqueues nothing while the purge job is still queued');

-- ── the rule that must never regress (ADR 0032) ─────────────────────────
select is(
  (select count(*)::int from public.assets
    where id = '00000000-0000-0000-0000-000000000a01'),
  1,
  'the sweep never deletes the asset row — purge keeps a dedup tombstone');

select * from finish();
rollback;
