-- asset_edits RLS (ADR 0030) — run: `supabase test db`. Gate for migration PRs
-- (ADR 0020). Proves: an edit is visible only to the asset's workspace members;
-- the reset DELETE is scoped to editors of the asset (viewers and outsiders
-- cannot delete); and the 'edit' job_type enum value exists.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
-- c3 is a VIEWER of WS-A (member but not editor) — the reset-delete denial hinge.
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000c3', 'viewer');
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo-1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-photo'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo-3');
insert into public.asset_edits (asset_id, recipe, edited_thumb_key, edited_medium_key) values
  ('00000000-0000-0000-0000-0000000000f1',
   '{"rotate":90,"flipH":false,"flipV":false,"straighten":0,"crop":null}',
   'aaaa/edits/f1/thumb.webp', 'aaaa/edits/f1/medium.webp'),
  ('00000000-0000-0000-0000-0000000000f2',
   '{"rotate":0,"flipH":true,"flipV":false,"straighten":0,"crop":null}',
   'bbbb/edits/f2/thumb.webp', 'bbbb/edits/f2/medium.webp'),
  ('00000000-0000-0000-0000-0000000000f3',
   '{"rotate":0,"flipH":false,"flipV":false,"straighten":5,"crop":null}',
   'aaaa/edits/f3/thumb.webp', 'aaaa/edits/f3/medium.webp');

-- ── user A (owner = editor of WS-A) ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.asset_edits), 2, 'A sees only WS-A edits (asset-child RLS)');
select lives_ok(
  $$delete from public.asset_edits where asset_id = '00000000-0000-0000-0000-0000000000f2'$$,
  'A deleting WS-B edit is a no-op (RLS filters the row), not an error');
select lives_ok(
  $$delete from public.asset_edits where asset_id = '00000000-0000-0000-0000-0000000000f3'$$,
  'A deletes own asset edit (is_editor_of_asset)');
select is((select count(*)::int from public.asset_edits where asset_id = '00000000-0000-0000-0000-0000000000f3'), 0,
  'A own edit actually gone');
select lives_ok(
  $$insert into public.ai_jobs (workspace_id, user_id, type, payload)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1',
            'edit', '{"asset_id":"00000000-0000-0000-0000-0000000000f1","recipe":{}}')$$,
  'edit job type enqueues (enum value exists)');

-- ── user B: A's cross-workspace delete must NOT have touched WS-B ────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.asset_edits where asset_id = '00000000-0000-0000-0000-0000000000f2'), 1,
  'WS-B edit survived A''s cross-workspace delete (delete RLS scoping)');

-- ── user C: viewer of WS-A — reads the edit but cannot reset it ──────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select is((select count(*)::int from public.asset_edits), 1, 'viewer sees WS-A edit (is_member_of_asset)');
select lives_ok(
  $$delete from public.asset_edits where asset_id = '00000000-0000-0000-0000-0000000000f1'$$,
  'viewer delete is a no-op (not an editor), not an error');

-- ── user A: viewer''s delete changed nothing ────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.asset_edits where asset_id = '00000000-0000-0000-0000-0000000000f1'), 1,
  'viewer could NOT delete the edit (is_editor_of_asset denied)');

-- ── worker-only writes: even an editor cannot INSERT or UPDATE an edit row
--    directly. There is NO insert/update policy (the worker writes as the
--    postgres role, bypassing RLS — same custody as topic_clusters / embeddings).
--    This is the load-bearing invariant: a forged/altered edited_*_key would make
--    the read path presign an ARBITRARY R2 object (lib/assets.ts, medium route),
--    so a future permissive policy must trip this gate. (Mirrors 004_topic_clusters.)
select throws_ok(
  $$insert into public.asset_edits (asset_id, recipe)
    values ('00000000-0000-0000-0000-0000000000f3', '{}')$$,
  '42501', null, 'editor cannot INSERT an asset_edits row (worker-only)');
select lives_ok(
  $$update public.asset_edits set edited_medium_key = 'aaaa/edits/f1/evil.webp'
      where asset_id = '00000000-0000-0000-0000-0000000000f1'$$,
  'editor UPDATE of an asset_edits row is a no-op (no update policy), not an error');
select is(
  (select edited_medium_key from public.asset_edits where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  'aaaa/edits/f1/medium.webp',
  'the edited key was NOT changed by the direct UPDATE (RLS blocked it)');

select * from finish();
rollback;
