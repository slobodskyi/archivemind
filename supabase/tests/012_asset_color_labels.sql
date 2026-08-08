-- Colour labels suite (pgTAP) — run: `supabase test db`
--
-- Covers migration 20260808000001: the `asset_label` enum and its exact seven
-- values (the UI indexes into that order for the 1–7 shortcuts), assets.label
-- riding the EXISTING assets_update policy rather than a new one, and the
-- workspace_labels rename table's own four policies.
--
-- The role gates are the point. A colour label is workspace-wide curation: a
-- viewer must READ it (an unnamed row of dots is unusable) and must not WRITE
-- it, and nobody outside the workspace may see or touch either.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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
-- C is a VIEWER of WS-A — the same shape as 011: it proves the role gate bites
-- inside the workspace, not just across workspaces.
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000c3', 'viewer');

insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-2'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-1');

-- ── schema ──────────────────────────────────────────────────────────────
select has_column('public', 'assets', 'label', 'assets.label exists');
select has_table('public', 'workspace_labels', 'workspace_labels exists');
-- The order is contractual, not cosmetic: packages/shared indexes ASSET_LABELS
-- by position for the 1–7 keyboard shortcuts and the swatch row.
select is(
  enum_range(null::asset_label)::text,
  '{red,orange,yellow,green,blue,purple,gray}',
  'asset_label carries the seven macOS colours in macOS order');
select is(
  (select label from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  null::asset_label,
  'a photo starts unlabelled');

-- ── user A: an editor of WS-A ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$update public.assets set label = 'red' where id = '00000000-0000-0000-0000-0000000000f1'$$,
  'an editor labels their own photo (rides the existing assets_update policy)');
select is(
  (select label from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  'red'::asset_label, 'the label landed');

-- Clearing is the same UPDATE with null — there is no separate delete path, and
-- re-picking the colour a photo already has is what the swatch toggle sends.
select lives_ok(
  $$update public.assets set label = null where id = '00000000-0000-0000-0000-0000000000f1'$$,
  'an editor clears a label');
select is(
  (select label from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  null::asset_label, 'the label is gone');

select throws_ok(
  $$update public.assets set label = 'chartreuse' where id = '00000000-0000-0000-0000-0000000000f1'$$,
  '22P02', null, 'a colour outside the enum is refused by the database, not just by zod');

select lives_ok(
  $$insert into public.workspace_labels (workspace_id, label, name)
    values ('00000000-0000-0000-0000-00000000aaaa', 'red', 'Rejected')$$,
  'an editor renames a colour for the workspace');

-- ── user C: a VIEWER of the same workspace ──────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is(
  (select name from public.workspace_labels where workspace_id = '00000000-0000-0000-0000-00000000aaaa'),
  'Rejected', 'a viewer READS the names (workspace_labels_select is is_member)');

-- RLS denial is a zero-row no-op, not an error, so the proof is that nothing moved.
update public.assets set label = 'blue' where id = '00000000-0000-0000-0000-0000000000f1';
select is(
  (select label from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  null::asset_label, 'a viewer cannot label a photo');

update public.workspace_labels set name = 'viewer wuz here'
  where workspace_id = '00000000-0000-0000-0000-00000000aaaa' and label = 'red';
select is(
  (select name from public.workspace_labels where workspace_id = '00000000-0000-0000-0000-00000000aaaa'),
  'Rejected', 'a viewer cannot rename a colour (workspace_labels_update is is_editor)');

select throws_ok(
  $$insert into public.workspace_labels (workspace_id, label, name)
    values ('00000000-0000-0000-0000-00000000aaaa', 'green', 'Picks')$$,
  '42501', null, 'a viewer cannot add a rename either');

-- ── user B: another workspace entirely ──────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is_empty(
  $$select label from public.workspace_labels$$,
  'B sees none of WS-A''s colour names — a rename is workspace-private');

update public.assets set label = 'purple' where id = '00000000-0000-0000-0000-0000000000f1';
select is(
  (select count(*) from public.assets where id = '00000000-0000-0000-0000-0000000000f1' and label is not null),
  0::bigint,
  'B''s update matched no visible row');

-- B labelling B's OWN photo must work, or the test above would prove nothing
-- about the policy (only that B typed the wrong id).
select lives_ok(
  $$update public.assets set label = 'green' where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'B labels B''s own photo');

-- ── the rename key ──────────────────────────────────────────────────────
-- One name per colour per workspace: the route upserts on this, so a missing
-- constraint would silently accumulate duplicate rows and make the resolved
-- name depend on row order.
reset role;
select throws_ok(
  $$insert into public.workspace_labels (workspace_id, label, name)
    values ('00000000-0000-0000-0000-00000000aaaa', 'red', 'Second')$$,
  '23505', null, 'a colour can only be named once per workspace');

select * from finish();
rollback;
