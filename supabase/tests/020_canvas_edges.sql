-- Canvas edges suite (pgTAP) — run: `supabase test db`
--
-- Covers migration 20260818000001 (ADR 0048): the canvas_edges table, its
-- exactly-one-endpoint-per-side CHECKs, direction-insensitive uniqueness,
-- immutability (no update policy at all), the endpoint pair-checks in the
-- INSERT policy, and the cascade story — including the one this table's
-- board_id CASCADE was chosen for: edges survive a board's 30-day trash window
-- and die only at sweep_trashed_boards().
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ── fixtures (as superuser) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.dev'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'A'),
  ('00000000-0000-0000-0000-0000000000b2', 'B'),
  ('00000000-0000-0000-0000-0000000000c3', 'C');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000bbbb', 'WS-B', '00000000-0000-0000-0000-0000000000b2');
-- C is a VIEWER of WS-A, so the role gate is proven inside the workspace and
-- not only across the boundary.
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000c3', 'viewer');
insert into public.projects (id, workspace_id, name, created_by) values
  ('00000000-0000-0000-0000-00000000dddd', '00000000-0000-0000-0000-00000000aaaa', 'P-A',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000dddb', '00000000-0000-0000-0000-00000000bbbb', 'P-B',
   '00000000-0000-0000-0000-0000000000b2');
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo-1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo-2'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo-3'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-photo');
insert into public.boards (id, workspace_id, project_id, name, created_by) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
   'Board-A', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-00000000dddb',
   'Board-B', '00000000-0000-0000-0000-0000000000b2');
insert into public.canvas_annotations (id, workspace_id, project_id, board_id, kind, x, y, w, h) values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-00000000dddd', '00000000-0000-0000-0000-0000000000e1', 'note', 0, 0, 180, 160),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-00000000bbbb',
   '00000000-0000-0000-0000-00000000dddb', '00000000-0000-0000-0000-0000000000e2', 'note', 0, 0, 180, 160);

-- ── schema ──────────────────────────────────────────────────────────────
select has_table('public', 'canvas_edges', 'canvas_edges exists');

-- An edge is a relation, not an annotation: NO geometry columns. If one ever
-- appears here, ADR 0048's line has been undone by accident.
select hasnt_column('public', 'canvas_edges', 'x', 'an edge carries no geometry');
select hasnt_column('public', 'canvas_edges', 'updated_at', 'an edge is immutable — nothing to timestamp');

-- Each side is exactly one of asset|annotation — refused by the database, not
-- just by zod.
select throws_ok(
  $$insert into public.canvas_edges (workspace_id, project_id, board_id, to_asset_id)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2')$$,
  '23514', null, 'a from-side with no endpoint is refused');
select throws_ok(
  $$insert into public.canvas_edges
      (workspace_id, project_id, board_id, from_asset_id, from_annotation_id, to_asset_id)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000ee01',
            '00000000-0000-0000-0000-0000000000f2')$$,
  '23514', null, 'a from-side with both endpoint kinds is refused');
select throws_ok(
  $$insert into public.canvas_edges (workspace_id, project_id, board_id, from_asset_id, to_asset_id)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1')$$,
  '23514', null, 'a self-loop is refused');

-- ── user A: an editor of WS-A ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$insert into public.canvas_edges
      (id, workspace_id, project_id, board_id, from_asset_id, to_asset_id, created_by)
    values ('00000000-0000-0000-0000-00000000ed01',
            '00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2',
            '00000000-0000-0000-0000-0000000000a1')$$,
  'an editor wires photo to photo in their own board');

select lives_ok(
  $$insert into public.canvas_edges
      (id, workspace_id, project_id, board_id, from_asset_id, to_annotation_id, created_by)
    values ('00000000-0000-0000-0000-00000000ed02',
            '00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000ee01',
            '00000000-0000-0000-0000-0000000000a1')$$,
  'an editor wires photo to note');

-- The pair is unique per board regardless of drawn direction: the reversed
-- duplicate is the same statement, and 23505 (not a silent second row) is what
-- lets the API answer 409.
select throws_ok(
  $$insert into public.canvas_edges (workspace_id, project_id, board_id, from_asset_id, to_asset_id)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2')$$,
  '23505', null, 'the same pair twice is refused');
select throws_ok(
  $$insert into public.canvas_edges (workspace_id, project_id, board_id, from_asset_id, to_asset_id)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1')$$,
  '23505', null, 'the reversed pair is the same edge and is refused too');

-- Immutability from inside a session: no update policy exists, so the write is
-- a zero-row no-op even for the editor who drew the edge.
update public.canvas_edges set to_asset_id = '00000000-0000-0000-0000-0000000000f1'
  where id = '00000000-0000-0000-0000-00000000ed02';
select is(
  (select to_annotation_id from public.canvas_edges where id = '00000000-0000-0000-0000-00000000ed02'),
  '00000000-0000-0000-0000-00000000ee01'::uuid,
  'even an editor cannot re-point an edge — drawn or deleted, never edited');

-- The pair-check half of the INSERT policy: A may not wire B's asset into A's
-- board, even though A is an editor of the row's workspace.
select throws_ok(
  $$insert into public.canvas_edges (workspace_id, project_id, board_id, from_asset_id, to_asset_id)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3')$$,
  '42501', null, 'wiring another workspace''s asset is refused by the pair-check');

-- And the board half: an edge cannot be filed under a foreign board.
select throws_ok(
  $$insert into public.canvas_edges (workspace_id, project_id, board_id, from_asset_id, to_asset_id)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e2',
            '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2')$$,
  '42501', null, 'filing an edge under another workspace''s board is refused');

-- ── user C: a VIEWER of the same workspace ──────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is(
  (select count(*) from public.canvas_edges)::int, 2,
  'a viewer READS the workspace''s edges — they are part of what the board says');

select throws_ok(
  $$insert into public.canvas_edges (workspace_id, project_id, board_id, from_asset_id, to_annotation_id)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
            '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000ee01')$$,
  '42501', null, 'a viewer cannot draw an edge');

delete from public.canvas_edges where id = '00000000-0000-0000-0000-00000000ed01';
select isnt_empty(
  $$select 1 from public.canvas_edges where id = '00000000-0000-0000-0000-00000000ed01'$$,
  'a viewer cannot delete an edge');

-- ── user B: another workspace entirely ──────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is_empty(
  $$select id from public.canvas_edges$$,
  'B sees none of WS-A''s edges');

-- B working in B's OWN workspace must succeed, or the denials above prove
-- nothing about the policy.
select lives_ok(
  $$insert into public.canvas_edges (id, workspace_id, project_id, board_id, from_asset_id, to_annotation_id)
    values ('00000000-0000-0000-0000-00000000ed03',
            '00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-00000000dddb',
            '00000000-0000-0000-0000-0000000000e2',
            '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000ee02')$$,
  'B wires B''s own asset to B''s own note');

-- ── cascades ────────────────────────────────────────────────────────────
reset role;

-- Deleting an endpoint takes the edge, silently — the whole reason endpoints
-- are real FKs and not jsonb ids.
delete from public.assets where id = '00000000-0000-0000-0000-0000000000f2';
select is_empty(
  $$select id from public.canvas_edges where id = '00000000-0000-0000-0000-00000000ed01'$$,
  'deleting an endpoint asset deletes the edge');
delete from public.canvas_annotations where id = '00000000-0000-0000-0000-00000000ee01';
select is_empty(
  $$select id from public.canvas_edges where id = '00000000-0000-0000-0000-00000000ed02'$$,
  'deleting an endpoint note deletes the edge');

-- ── the board trash window ──────────────────────────────────────────────
-- board_id is CASCADE precisely because boards soft-delete: stamping
-- deleted_at touches nothing, so edges survive the 30-day trash window and a
-- restore is whole; only sweep_trashed_boards()'s hard DELETE takes them.
insert into public.canvas_edges (id, workspace_id, project_id, board_id, from_asset_id, to_asset_id) values
  ('00000000-0000-0000-0000-00000000ed04',
   '00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dddd',
   '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f4');

update public.boards set deleted_at = now() - interval '31 days'
  where id = '00000000-0000-0000-0000-0000000000e1';
select isnt_empty(
  $$select id from public.canvas_edges where id = '00000000-0000-0000-0000-00000000ed04'$$,
  'a trashed board''s edges survive the trash window — a restore is whole');

select is(sweep_trashed_boards(interval '30 days'), 1,
  'the sweep hard-deletes the expired board');
select is_empty(
  $$select id from public.canvas_edges where id = '00000000-0000-0000-0000-00000000ed04'$$,
  'and the board CASCADE finally takes its edges');

select * from finish();
rollback;
