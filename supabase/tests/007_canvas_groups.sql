-- canvas_groups / canvas_group_assets RLS (pgTAP) — run: `supabase test db`.
-- Folders + artboards share one server model (ADR 0034). Verifies workspace
-- isolation, membership isolation (mirrors project_assets, issue #17), the kind
-- enum, and the "delete cascades membership but keeps the assets" invariant
-- (a group is a curated subset, not a container of bytes).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ── fixtures (as superuser) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'A'),
  ('00000000-0000-0000-0000-0000000000b2', 'B');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000bbbb', 'WS-B', '00000000-0000-0000-0000-0000000000b2');
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner');
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo');

-- ── user A: create a folder + an artboard, link own asset ────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$insert into public.canvas_groups (id, workspace_id, project_id, kind, name, created_by)
      values ('00000000-0000-0000-0000-0000000000c1',
              '00000000-0000-0000-0000-00000000aaaa', null, 'folder', 'A-folder',
              '00000000-0000-0000-0000-0000000000a1')$$,
  'editor creates a folder in own workspace');
select lives_ok(
  $$insert into public.canvas_groups (id, workspace_id, kind, name, created_by)
      values ('00000000-0000-0000-0000-0000000000c2',
              '00000000-0000-0000-0000-00000000aaaa', 'artboard', 'A-board',
              '00000000-0000-0000-0000-0000000000a1')$$,
  'kind enum accepts artboard');
select lives_ok(
  $$insert into public.canvas_group_assets (group_id, asset_id, position)
      values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 0)$$,
  'owner links own asset into own group');
select is((select count(*)::int from public.canvas_groups), 2, 'A sees own groups');
select is((select count(*)::int from public.canvas_group_assets), 1, 'A sees own group membership');

-- ── user B: isolation ────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.canvas_groups), 0, 'B sees no WS-A groups');
select is((select count(*)::int from public.canvas_group_assets), 0,
  'B sees no WS-A membership (group-scoped RLS)');
select throws_ok(
  $$insert into public.canvas_groups (workspace_id, kind, name)
    values ('00000000-0000-0000-0000-00000000aaaa', 'folder', 'intruder')$$,
  '42501', null, 'cross-workspace group insert blocked by RLS');
select throws_ok(
  $$insert into public.canvas_group_assets (group_id, asset_id)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'non-member cannot link into another workspace''s group');

-- ── delete cascades membership, keeps the asset (subset, not container) ───
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
delete from public.canvas_groups where id = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select count(*)::int from public.canvas_group_assets
     where group_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'deleting a group cascades its membership rows');
select is(
  (select count(*)::int from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  1, 'the group''s assets survive the delete');

select * from finish();
rollback;
