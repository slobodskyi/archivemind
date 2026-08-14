-- Durable content drafts (pgTAP) — run: `supabase test db`.
-- Covers migration 20260814000001 / ADR 0045 amendment: member reads, editor
-- writes, tenant isolation, upsert-by-client-id (a retry cannot duplicate a
-- draft), stale-version refusal, soft delete and undo, and the board lifecycle.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ── fixtures ────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000e2', 'editor-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000c3', 'viewer-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b4', 'owner-b@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Editor A'),
  ('00000000-0000-0000-0000-0000000000c3', 'Viewer A'),
  ('00000000-0000-0000-0000-0000000000b4', 'Owner B');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000bbbb', 'WS-B', '00000000-0000-0000-0000-0000000000b4');
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000e2', 'editor'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000c3', 'viewer'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b4', 'owner');
insert into public.projects (id, workspace_id, name, created_by) values
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-00000000aaaa', 'P-A',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000ddb2', '00000000-0000-0000-0000-00000000bbbb', 'P-B',
   '00000000-0000-0000-0000-0000000000b4');
insert into public.boards (id, workspace_id, project_id, name, created_by) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-00000000dda1', 'Story', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-00000000dda1', 'Doomed', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-00000000bbbb',
   '00000000-0000-0000-0000-00000000ddb2', 'Foreign', '00000000-0000-0000-0000-0000000000b4');

-- ── schema and capability surface ──────────────────────────────────────
select has_table('public', 'content_drafts', 'content_drafts exists');
select has_column('public', 'content_drafts', 'client_id',
  'the browser draft id has a column: a publication references the draft by it');
select ok(not has_function_privilege('anon', 'public.save_content_draft(uuid,text,text,text,jsonb,integer)', 'EXECUTE'),
  'anon cannot write drafts');
select ok(has_function_privilege('authenticated', 'public.save_content_draft(uuid,text,text,text,jsonb,integer)', 'EXECUTE'),
  'a signed-in caller reaches save, which performs its own editor check');

-- ── viewer and tenant gates ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select throws_ok(
  $$select * from public.save_content_draft(
      '00000000-0000-0000-0000-0000000000e1', 'viewer-draft', 'article', 'Viewer',
      '{"kind":"article"}'::jsonb, 1)$$,
  '42501', 'content_draft_editor_required', 'a viewer cannot save a draft');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok(
  $$select * from public.save_content_draft(
      '00000000-0000-0000-0000-0000000000eb', 'foreign-draft', 'article', 'Foreign',
      '{"kind":"article"}'::jsonb, 1)$$,
  '42501', 'content_draft_editor_required', 'an editor cannot save into a foreign board');

select throws_ok(
  $$select * from public.save_content_draft(
      '00000000-0000-0000-0000-0000000000e1', '  ', 'article', 'Blank id',
      '{"kind":"article"}'::jsonb, 1)$$,
  '22023', 'invalid_content_draft', 'a blank client id is refused');

select throws_ok(
  $$select * from public.save_content_draft(
      '00000000-0000-0000-0000-0000000000e1', 'bad-kind', 'zine', 'Bad kind',
      '{"kind":"zine"}'::jsonb, 1)$$,
  '22023', 'invalid_content_draft', 'only the two editor kinds are storable');

-- ── the ordinary save path ─────────────────────────────────────────────
select is((select draft_version from public.save_content_draft(
            '00000000-0000-0000-0000-0000000000e1', 'draft-main', 'article', 'Main story',
            '{"kind":"article","content":{"title":"One"}}'::jsonb, 1)),
  1, 'an editor saves a first version');
select is((select count(*)::int from public.content_drafts), 1,
  'exactly one row exists after the first save');

-- The autosave debounce retries on a dropped response; the browser's own id is
-- the upsert key precisely so that cannot mint a second copy of one draft.
select is((select draft_version from public.save_content_draft(
            '00000000-0000-0000-0000-0000000000e1', 'draft-main', 'article', 'Main story',
            '{"kind":"article","content":{"title":"Two"}}'::jsonb, 2)),
  2, 'saving again advances the version');
select is((select count(*)::int from public.content_drafts), 1,
  'a repeat save updates in place rather than duplicating the draft');
select is((select document->'content'->>'title' from public.content_drafts
            where client_id = 'draft-main'),
  'Two', 'the newer envelope replaced the older one');

-- ── a stale tab must not undo newer paragraphs ─────────────────────────
select is((select is_stale from public.save_content_draft(
            '00000000-0000-0000-0000-0000000000e1', 'draft-main', 'article', 'Main story',
            '{"kind":"article","content":{"title":"Stale"}}'::jsonb, 1)),
  true, 'an older version reports stale instead of overwriting');
select is((select document->'content'->>'title' from public.content_drafts
            where client_id = 'draft-main'),
  'Two', 'the stored document is untouched by the stale write');
select is((select draft_version from public.save_content_draft(
            '00000000-0000-0000-0000-0000000000e1', 'draft-main', 'article', 'Main story',
            '{"kind":"article","content":{"title":"Same"}}'::jsonb, 2)),
  2, 'an equal version still writes: it is the same editor saving again');

-- ── reads follow membership ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select is((select count(*)::int from public.content_drafts), 1,
  'a viewer can read the workspace''s drafts');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select is((select count(*)::int from public.content_drafts), 0,
  'another tenant sees no drafts at all');
-- RLS on UPDATE filters rather than raises, so a blind cross-tenant write is
-- not an error — it simply matches no rows. What has to be proven is that
-- nothing changed, which only a member of the target workspace can see.
update public.content_drafts set name = 'Stolen';

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is((select name from public.content_drafts where client_id = 'draft-main'),
  'Main story', 'a foreign owner''s blind write touches nothing in this workspace');

-- ── soft delete, and undo bringing the same draft back ─────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok(
  $$update public.content_drafts set deleted_at = now() where client_id = 'draft-main'$$,
  'an editor trashes a draft');
select is((select count(*)::int from public.content_drafts where deleted_at is null), 0,
  'a trashed draft leaves the live set');
select is((select draft_version from public.save_content_draft(
            '00000000-0000-0000-0000-0000000000e1', 'draft-main', 'article', 'Main story',
            '{"kind":"article","content":{"title":"Restored"}}'::jsonb, 3)),
  3, 'undo re-saves the same draft id');
select is((select count(*)::int from public.content_drafts where deleted_at is null), 1,
  'the restored draft is live again rather than a second copy');

-- A publication made from this draft refers to it by exactly this id, so undo
-- must not renumber it or the share loses its source (ADR 0046).
select is((select client_id from public.content_drafts), 'draft-main',
  'the browser draft id survives delete and restore unchanged');

-- ── the board lifecycle owns its drafts ────────────────────────────────
select is((select draft_version from public.save_content_draft(
            '00000000-0000-0000-0000-0000000000e9', 'draft-doomed', 'instagram_carousel', 'Doomed post',
            '{"kind":"instagram_carousel"}'::jsonb, 1)),
  1, 'a draft is saved against a second board');

reset role;
update public.boards set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000e9';
select is((select count(*)::int from public.content_drafts where client_id = 'draft-doomed'), 1,
  'trashing a board keeps its drafts, so a restore inside 30 days is whole');

delete from public.boards where id = '00000000-0000-0000-0000-0000000000e9';
select is((select count(*)::int from public.content_drafts where client_id = 'draft-doomed'), 0,
  'a hard-deleted board takes its drafts with it: their source files are gone');

select * from finish();
rollback;
