-- Trash retention suite (pgTAP) — run: `supabase test db`
-- Gate for migration PRs (ADR 0013 / issue #31). Covers sweep_trashed_projects()
-- from migration 20260714000001: the grace window, what it must NOT touch, and
-- the rule that matters most — assets are workspace-global and survive a swept
-- project (ADR 0019 / TECH_SPEC §3 rule 9).
--
-- No time travel needed: the fixtures set deleted_at in the past and the
-- function is called directly, rather than waiting on the worker's schedule.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- ── fixtures (as superuser; RLS is 001's job, not this suite's) ──────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d4', 'd@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000d4', 'D');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000dddd', 'WS-D', '00000000-0000-0000-0000-0000000000d4');
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000dddd', '00000000-0000-0000-0000-0000000000d4', 'owner');
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000dddd', 'photo', 'D-photo');

insert into public.projects (id, workspace_id, name, archived_at, deleted_at) values
  -- expired trash → must go
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-00000000dddd',
   'expired',   null, now() - interval '31 days'),
  -- still inside the window → must stay
  ('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-00000000dddd',
   'recent',    null, now() - interval '29 days'),
  -- archived but never trashed → must stay, however old
  ('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-00000000dddd',
   'archived',  now() - interval '400 days', null),
  -- plain active → must stay
  ('00000000-0000-0000-0000-000000000904', '00000000-0000-0000-0000-00000000dddd',
   'active',    null, null);

-- the expired project owns a link to the workspace's only asset
insert into public.project_assets (project_id, asset_id) values
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000000e1');

-- ── the sweep ───────────────────────────────────────────────────────────
select is(
  (select public.sweep_trashed_projects()), 1,
  'sweep removes exactly the one project past the 30-day window');

select is(
  (select count(*)::int from public.projects
    where id = '00000000-0000-0000-0000-000000000901'), 0,
  'expired trashed project is gone');

select is(
  (select count(*)::int from public.projects
    where id = '00000000-0000-0000-0000-000000000902'), 1,
  'trashed 29 days ago survives — grace window is respected, not approximated');

select is(
  (select count(*)::int from public.projects
    where id = '00000000-0000-0000-0000-000000000903'), 1,
  'archived-but-not-trashed survives regardless of age (archive is not trash)');

select is(
  (select count(*)::int from public.projects
    where id = '00000000-0000-0000-0000-000000000904'), 1,
  'active project untouched');

-- ── the rule that must never regress ────────────────────────────────────
select is(
  (select count(*)::int from public.project_assets
    where project_id = '00000000-0000-0000-0000-000000000901'), 0,
  'project_assets link rows cascade with the swept project');

select is(
  (select count(*)::int from public.assets
    where id = '00000000-0000-0000-0000-0000000000e1'), 1,
  'the asset itself SURVIVES — projects are M:N subsets, not containers');

select * from finish();
rollback;
