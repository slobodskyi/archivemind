-- Canvas annotations suite (pgTAP) — run: `supabase test db`
--
-- Covers migration 20260808000002 (ADR 0041): the canvas_annotations table, its
-- kind enum, the geometry columns that make this table different from every
-- other canvas concern, and the four RLS policies.
--
-- The role gates are the point, same as 012. An annotation is workspace-wide
-- content, not per-user view state — that is the whole reason it left
-- localStorage — so a viewer must READ it (a note nobody else can see is the
-- defect being fixed) and must not WRITE it, and nobody outside the workspace
-- may see or touch it at all.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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
   '00000000-0000-0000-0000-0000000000a1');

-- ── schema ──────────────────────────────────────────────────────────────
select has_table('public', 'canvas_annotations', 'canvas_annotations exists');

-- 'ink' has no writer yet. It is in the enum so freehand ink ships as UI plus a
-- body shape, with no second migration — migrations here are append-only, so
-- the value has to be present before it is needed or not at all.
select is(
  enum_range(null::canvas_annotation_kind)::text,
  '{note,ink}',
  'canvas_annotation_kind carries note and ink');

-- The columns that make this table the documented exception to ADR 0022/0034.
-- A photo's position is a per-user view preference and stays in localStorage; an
-- annotation's position is its content, so it is here. If these ever disappear,
-- the exception has been undone by accident.
select has_column('public', 'canvas_annotations', 'x', 'geometry lives on the row: x');
select has_column('public', 'canvas_annotations', 'y', 'geometry lives on the row: y');

-- The note palette is the ADR 0040 seven, reused rather than re-picked, so the
-- two swatch rows cannot fork. A separate note_color enum would be that fork.
select is(
  (select t.typname
     from pg_attribute a join pg_type t on t.oid = a.atttypid
    where a.attrelid = 'public.canvas_annotations'::regclass and a.attname = 'color'),
  'asset_label',
  'a note''s colour is the same enum a label uses');

select throws_ok(
  $$insert into public.canvas_annotations (workspace_id, kind, x, y, w, h, color)
    values ('00000000-0000-0000-0000-00000000aaaa', 'note', 0, 0, 180, 160, 'chartreuse')$$,
  '22P02', null, 'a colour outside the enum is refused by the database, not just by zod');

-- ── user A: an editor of WS-A ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$insert into public.canvas_annotations
      (id, workspace_id, project_id, kind, x, y, w, h, body, created_by)
    values ('00000000-0000-0000-0000-00000000e001',
            '00000000-0000-0000-0000-00000000aaaa',
            '00000000-0000-0000-0000-00000000dddd',
            'note', 120, 240, 180, 160, '{"text":"call the picture desk"}'::jsonb,
            '00000000-0000-0000-0000-0000000000a1')$$,
  'an editor creates a note in their own workspace');

select is(
  (select color from public.canvas_annotations where id = '00000000-0000-0000-0000-00000000e001'),
  'yellow'::asset_label,
  'a note defaults to yellow — unlike a label there is no unset state');

select is(
  (select body ->> 'text' from public.canvas_annotations
    where id = '00000000-0000-0000-0000-00000000e001'),
  'call the picture desk', 'the text round-trips through jsonb');

-- A drag is a PATCH of x/y only. Proving the write path here means the route's
-- sparse patch has a policy that actually allows it.
select lives_ok(
  $$update public.canvas_annotations set x = 400, y = 90
     where id = '00000000-0000-0000-0000-00000000e001'$$,
  'an editor moves a note');

-- project_id null = the workspace-wide 'all' canvas, the same scoping
-- canvas_groups uses. Both shapes must be insertable or one scope is dead.
select lives_ok(
  $$insert into public.canvas_annotations (workspace_id, project_id, kind, x, y, w, h)
    values ('00000000-0000-0000-0000-00000000aaaa', null, 'note', 0, 0, 180, 160)$$,
  'a workspace-scoped annotation (project_id null) is allowed');

-- ── user C: a VIEWER of the same workspace ──────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is(
  (select body ->> 'text' from public.canvas_annotations
    where id = '00000000-0000-0000-0000-00000000e001'),
  'call the picture desk',
  'a viewer READS notes (canvas_annotations_select is is_member) — the whole point of leaving localStorage');

-- RLS denial is a zero-row no-op, not an error, so the proof is that nothing moved.
update public.canvas_annotations set body = '{"text":"viewer wuz here"}'::jsonb
  where id = '00000000-0000-0000-0000-00000000e001';
select is(
  (select body ->> 'text' from public.canvas_annotations
    where id = '00000000-0000-0000-0000-00000000e001'),
  'call the picture desk', 'a viewer cannot edit a note (canvas_annotations_update is is_editor)');

delete from public.canvas_annotations where id = '00000000-0000-0000-0000-00000000e001';
select isnt_empty(
  $$select 1 from public.canvas_annotations where id = '00000000-0000-0000-0000-00000000e001'$$,
  'a viewer cannot delete a note');

select throws_ok(
  $$insert into public.canvas_annotations (workspace_id, kind, x, y, w, h)
    values ('00000000-0000-0000-0000-00000000aaaa', 'note', 1, 1, 180, 160)$$,
  '42501', null, 'a viewer cannot create one either');

-- ── user B: another workspace entirely ──────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is_empty(
  $$select id from public.canvas_annotations$$,
  'B sees none of WS-A''s notes — an annotation is workspace-private');

update public.canvas_annotations set x = -1 where id = '00000000-0000-0000-0000-00000000e001';

-- B writing in B's OWN workspace must work, or the check below would prove
-- nothing about the policy (only that B typed the wrong id).
select lives_ok(
  $$insert into public.canvas_annotations (workspace_id, kind, x, y, w, h)
    values ('00000000-0000-0000-0000-00000000bbbb', 'note', 5, 5, 180, 160)$$,
  'B creates a note in B''s own workspace');

-- ── cascade ─────────────────────────────────────────────────────────────
-- Back to superuser: B's failed UPDATE has to be verified from outside RLS,
-- because from inside B's session the row is invisible and the read would come
-- back null whether the write landed or not.
reset role;
select is(
  (select x from public.canvas_annotations where id = '00000000-0000-0000-0000-00000000e001'),
  400::double precision,
  'B''s update matched no visible row — A''s note is untouched');

-- A note belongs to the canvas of a project, so deleting the project takes it.
-- Without the FK cascade the row would survive as an orphan the reader can
-- never scope to anything.
delete from public.projects where id = '00000000-0000-0000-0000-00000000dddd';
select is_empty(
  $$select id from public.canvas_annotations
     where id = '00000000-0000-0000-0000-00000000e001'$$,
  'deleting a project takes its annotations with it');

select * from finish();
rollback;
