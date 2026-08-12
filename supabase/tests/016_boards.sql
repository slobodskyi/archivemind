-- boards / board_assets RLS + ownership (pgTAP) — run: `supabase test db`.
-- A Workspace is a named subset of one project's files (ADR 0044). Verifies
-- workspace isolation on both tables, the cross-workspace asset leak the
-- board_assets insert policy exists to stop, and the two invariants that decide
-- whether deleting a workspace loses work: membership cascades, but the notes
-- and folders MADE in it survive with board_id nulled.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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
insert into public.projects (id, workspace_id, name, created_by) values
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-00000000aaaa', 'P-A',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000ddb2', '00000000-0000-0000-0000-00000000bbbb', 'P-B',
   '00000000-0000-0000-0000-0000000000b2');
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-photo');

-- ── user A ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$insert into public.boards (id, workspace_id, project_id, name, color, created_by)
      values ('00000000-0000-0000-0000-0000000000e1',
              '00000000-0000-0000-0000-00000000aaaa',
              '00000000-0000-0000-0000-00000000dda1', 'Pitch', 'blue',
              '00000000-0000-0000-0000-0000000000a1')$$,
  'editor creates a board in own workspace');

select throws_ok(
  $$insert into public.boards (workspace_id, project_id, name, created_by)
      values ('00000000-0000-0000-0000-00000000bbbb',
              '00000000-0000-0000-0000-00000000ddb2', 'Sneak',
              '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'cannot create a board in a foreign workspace');

select lives_ok(
  $$insert into public.board_assets (board_id, asset_id)
      values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1')$$,
  'editor links own asset to own board');

-- The reason the insert policy checks the ASSET's workspace as well as the
-- board's: without it this row would be accepted and workspace B's photo would
-- appear on A's canvas.
select throws_ok(
  $$insert into public.board_assets (board_id, asset_id)
      values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2')$$,
  '42501', null, 'cannot link a foreign asset to own board');

select is(
  (select count(*)::int from public.board_assets
     where board_id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'A sees exactly its own membership row');

-- Objects made inside the board carry it.
select lives_ok(
  $$insert into public.canvas_groups (id, workspace_id, project_id, kind, name, board_id, created_by)
      values ('00000000-0000-0000-0000-0000000000c1',
              '00000000-0000-0000-0000-00000000aaaa',
              '00000000-0000-0000-0000-00000000dda1', 'folder', 'A-folder',
              '00000000-0000-0000-0000-0000000000e1',
              '00000000-0000-0000-0000-0000000000a1')$$,
  'a folder records the board it was made in');

select lives_ok(
  $$insert into public.canvas_annotations
      (id, workspace_id, project_id, kind, x, y, w, h, color, body, board_id, created_by)
      values ('00000000-0000-0000-0000-0000000000d1',
              '00000000-0000-0000-0000-00000000aaaa',
              '00000000-0000-0000-0000-00000000dda1', 'note', 10, 10, 200, 180, 'yellow',
              '{"text":"hi","strokes":[]}'::jsonb,
              '00000000-0000-0000-0000-0000000000e1',
              '00000000-0000-0000-0000-0000000000a1')$$,
  'a note records the board it was made in');

-- ── user B sees none of it ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is((select count(*)::int from public.boards), 0,
  'B sees no board from workspace A');
select is((select count(*)::int from public.board_assets), 0,
  'B sees no board membership from workspace A');
-- An UPDATE blocked by RLS does not raise: the USING clause simply filters the
-- row out, so the statement SUCCEEDS having touched nothing. That is why the
-- proof is the pair — this runs, and the next assertion (back as A) shows the
-- name never moved. Counting affected rows would need a data-modifying CTE,
-- which Postgres only allows at the top level, not inside `select is(...)`.
select lives_ok(
  $$update public.boards set name = 'Mine'
      where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'B''s rename of A''s board is not rejected — it matches nothing');

-- ── back as A: the rename really did not land ────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select name from public.boards where id = '00000000-0000-0000-0000-0000000000e1'),
  'Pitch', 'A''s board keeps its name');

-- ── deleting a board keeps the work ──────────────────────────────────────
delete from public.boards where id = '00000000-0000-0000-0000-0000000000e1';

select is((select count(*)::int from public.board_assets), 0,
  'deleting a board cascades its membership rows');
select is(
  (select count(*)::int from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  1, 'deleting a board keeps the asset — a board is a subset, not a container');
select is(
  (select board_id from public.canvas_groups where id = '00000000-0000-0000-0000-0000000000c1'),
  null::uuid, 'a folder outlives its board with board_id nulled, not deleted');
select is(
  (select board_id from public.canvas_annotations where id = '00000000-0000-0000-0000-0000000000d1'),
  null::uuid, 'a note outlives its board with board_id nulled, not deleted');

select * from finish();
rollback;
