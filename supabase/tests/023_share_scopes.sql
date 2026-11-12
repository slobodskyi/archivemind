-- Share scopes and opt-in details (pgTAP) — run: `supabase test db`.
-- Covers migration 20261112000001 / ADR 0053: a link carries a project, one
-- Workspace of it, or a fixed list of its files, and every public resolver
-- (page, listing, media, ZIP) serves exactly that scope; a Workspace link
-- follows membership and pauses with its Workspace's Trash; a list never
-- grows; details are off unless the link turned them on, a detail that is off
-- is null and cannot be filtered on; and a file sent through a Workspace link
-- lands in that Workspace. 022 keeps covering everything ADR 0051 promised.
begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

-- ── fixtures (superuser) ────────────────────────────────────────────────
-- K1 "Kyiv" (Odesa): f1 f2 f4 · K3 "Lviv" (Odesa): f3 · K2 (Other): f6.
-- f1 red, tags river(object) + river(scene) + bridge, an en/agency caption ·
-- f2 tag river · f3 red · f4 red but in Trash · f6 another project · fb B's.
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
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-00000000aaaa', 'Odesa',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000dda2', '00000000-0000-0000-0000-00000000aaaa', 'Other',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000ddb2', '00000000-0000-0000-0000-00000000bbbb', 'Foreign',
   '00000000-0000-0000-0000-0000000000b4');
insert into public.boards (id, workspace_id, project_id, name, color, sort_order) values
  ('00000000-0000-0000-0000-0000000b0a01', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-00000000dda1', 'Kyiv', 'green', 0),
  ('00000000-0000-0000-0000-0000000b0a02', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-00000000dda2', 'Elsewhere', 'blue', 0),
  ('00000000-0000-0000-0000-0000000b0a03', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-00000000dda1', 'Lviv', 'blue', 1);
insert into public.assets (id, workspace_id, kind, title, status, label) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'bridge.jpg', 'active', 'red'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'river.jpg', 'active', null),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'lviv.jpg', 'active', 'red'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'trashed.jpg', 'deleted', 'red'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'other.jpg', 'active', null),
  ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'foreign.jpg', 'active', null);
insert into public.project_assets (project_id, asset_id) values
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f3'),
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f4'),
  ('00000000-0000-0000-0000-00000000dda2', '00000000-0000-0000-0000-0000000000f6'),
  ('00000000-0000-0000-0000-00000000ddb2', '00000000-0000-0000-0000-0000000000fb');
insert into public.board_assets (board_id, asset_id, position) values
  ('00000000-0000-0000-0000-0000000b0a01', '00000000-0000-0000-0000-0000000000f1', 0),
  ('00000000-0000-0000-0000-0000000b0a01', '00000000-0000-0000-0000-0000000000f2', 1),
  ('00000000-0000-0000-0000-0000000b0a01', '00000000-0000-0000-0000-0000000000f4', 2),
  ('00000000-0000-0000-0000-0000000b0a03', '00000000-0000-0000-0000-0000000000f3', 0),
  ('00000000-0000-0000-0000-0000000b0a02', '00000000-0000-0000-0000-0000000000f6', 0);
insert into public.asset_previews (asset_id, size, r2_key, width, height) values
  ('00000000-0000-0000-0000-0000000000f1', 'thumb', '00000000-0000-0000-0000-00000000aaaa/previews/f1/thumb.webp', 256, 171),
  ('00000000-0000-0000-0000-0000000000f2', 'thumb', '00000000-0000-0000-0000-00000000aaaa/previews/f2/thumb.webp', 256, 171),
  ('00000000-0000-0000-0000-0000000000f3', 'thumb', '00000000-0000-0000-0000-00000000aaaa/previews/f3/thumb.webp', 256, 171);
insert into public.tags (id, workspace_id, name, category) values
  ('00000000-0000-0000-0000-000000007a01', '00000000-0000-0000-0000-00000000aaaa', 'river', 'object'),
  ('00000000-0000-0000-0000-000000007a02', '00000000-0000-0000-0000-00000000aaaa', 'river', 'scene'),
  ('00000000-0000-0000-0000-000000007a03', '00000000-0000-0000-0000-00000000aaaa', 'bridge', 'object');
insert into public.asset_tags (asset_id, tag_id, confidence) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000007a01', 0.9),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000007a02', 0.6),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000007a03', 0.8),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000007a01', 0.7);
insert into public.captions (asset_id, lang, style, text) values
  ('00000000-0000-0000-0000-0000000000f1', 'en', 'agency', 'A bridge over the river.'),
  ('00000000-0000-0000-0000-0000000000f1', 'uk', 'agency', 'Міст над річкою.');

create temporary table t_links (name text primary key, id uuid);
create temporary table t_res (name text primary key, id uuid);
create temporary table t_jobs (name text primary key, id uuid);
grant select, insert on table t_links, t_res, t_jobs to authenticated, service_role;

-- ── capability surface ─────────────────────────────────────────────────
select has_table('public', 'project_share_assets', 'project_share_assets exists');
select ok(not has_table_privilege('authenticated', 'public.project_share_assets', 'SELECT'),
  'a selection''s list is not readable around the RPCs');
select ok(not has_function_privilege('anon',
  'public.create_project_share(uuid,boolean,boolean,integer,text,text,text,text,uuid,uuid[],boolean,boolean,boolean,text,text)', 'EXECUTE'),
  'anon cannot mint a scoped link');
select ok(not has_function_privilege('authenticated', 'public.list_project_share_facets(text)', 'EXECUTE'),
  'the filter row is a server-only resolver');
select ok(has_function_privilege('service_role', 'public.list_project_share_facets(text)', 'EXECUTE'),
  'the fenced integration may read it');
select ok(not has_function_privilege('authenticated',
  'public.list_project_share_assets(text,timestamptz,uuid,integer,uuid,text,text)', 'EXECUTE'),
  'the widened listing is still server-only');
select ok(not has_function_privilege('authenticated', 'public.project_share_scope_assets(project_shares)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.project_share_is_live(project_shares)', 'EXECUTE'),
  'the scope and liveness helpers are no API');
select ok(not has_function_privilege('anon', 'public.list_project_share_scope(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_project_share_scope(uuid)', 'EXECUTE'),
  'Show on canvas is for signed-in editors, who the function checks itself');

-- ── creation ───────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

insert into t_links
select 'compat', id
  from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('a1', 32), null);
insert into t_links
select 'details', id
  from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('d1', 32), null,
    p_show_boards => true, p_show_labels => true, p_show_tags => true,
    p_caption_lang => 'en', p_caption_style => 'agency');
insert into t_links
select 'board', id
  from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, true, 7, null,
    repeat('b1', 32), null,
    p_scope => 'board', p_board_id => '00000000-0000-0000-0000-0000000b0a01');
insert into t_links
select 'selection', id
  from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('5e', 32), null,
    p_scope => 'selection',
    p_asset_ids => array[
      '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3',
      '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f6',
      '00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000f4'
    ]::uuid[]);

select is((select count(*)::int from t_links), 4, 'a project, a Workspace and a list link are all minted');

select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_scope => 'folder')$$,
  '22023', 'invalid_project_share_scope', 'a scope is project, board or selection');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_scope => 'board')$$,
  '22023', 'invalid_project_share_board', 'a Workspace link names its Workspace');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_scope => 'board', p_board_id => '00000000-0000-0000-0000-0000000b0a02')$$,
  '22023', 'invalid_project_share_board', 'a Workspace of another project cannot be shared through this one');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_board_id => '00000000-0000-0000-0000-0000000b0a01')$$,
  '22023', 'invalid_project_share_board', 'a project link carries no Workspace');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, true, 7, null,
    repeat('ee', 32), null, p_scope => 'selection',
    p_asset_ids => array['00000000-0000-0000-0000-0000000000f1']::uuid[])$$,
  '22023', 'invalid_project_share_rights', 'a fixed list cannot receive files');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_scope => 'selection',
    p_asset_ids => array['00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000fb',
                         '00000000-0000-0000-0000-0000000000f4']::uuid[])$$,
  '22023', 'project_share_selection_empty', 'a list of nothing live in the project is refused');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_scope => 'selection', p_asset_ids => array[]::uuid[])$$,
  '22023', 'invalid_project_share_selection', 'an empty list is refused');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_asset_ids => array['00000000-0000-0000-0000-0000000000f1']::uuid[])$$,
  '22023', 'invalid_project_share_selection', 'only a selection link carries a list');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_scope => 'board', p_board_id => '00000000-0000-0000-0000-0000000b0a01',
    p_show_boards => true)$$,
  '22023', 'invalid_project_share_details', 'Workspaces as a filter exist on a project link only');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_caption_lang => 'en')$$,
  '22023', 'invalid_project_share_details', 'a caption is a language AND a style');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('ee', 32), null, p_caption_lang => 'de', p_caption_style => 'agency')$$,
  '22023', 'invalid_project_share_details', 'an unknown caption language is refused, not cast');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', false, true, 7, null,
    repeat('ee', 32), null, p_show_labels => true)$$,
  '22023', 'invalid_project_share_details', 'an upload-only link shows no details: it shows no files');

reset role;
select throws_ok(
  $$insert into public.project_shares (workspace_id, project_id, can_download, can_upload, token_hash, expires_at, scope)
    values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-00000000dda1', true, true,
            decode(repeat('ab', 32), 'hex'), now() + interval '1 day', 'selection')$$,
  '23514', null, 'the table itself refuses an upload right on a list');
select results_eq(
  $$select asset_id from public.project_share_assets
     where share_id = (select id from t_links where name = 'selection') order by asset_id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f3'::uuid)$$,
  'a list keeps only files live in the project, once each');
select is((select scope::text from public.project_shares where id = (select id from t_links where name = 'compat')),
  'project', 'a link made the ADR 0051 way is a project link');
select ok((select not (show_boards or show_labels or show_tags) and caption_lang is null
             from public.project_shares where id = (select id from t_links where name = 'compat')),
  'and shows no details');

-- ── editor listing ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

select is((select scope from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'board')), 'board',
  'the list says what each link carries');
select is((select board_name from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'board')), 'Kyiv',
  'and names the Workspace');
select is((select file_count from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'board')), 2,
  'a Workspace link counts its live members only');
select is((select file_count from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'selection')), 2,
  'a list counts what it kept');
select is((select caption_lang || '/' || caption_style
             from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'details')), 'en/agency',
  'and which caption it shows');
select results_eq(
  $$select asset_id from public.list_project_share_scope((select id from t_links where name = 'board')) order by asset_id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f2'::uuid)$$,
  'Show on canvas gets exactly the link''s files');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select throws_ok(
  $$select * from public.list_project_share_scope((select id from t_links where name = 'board'))$$,
  '42501', 'project_share_editor_required', 'a viewer cannot list a link''s files');
select is((select live_count from public.list_board_share_counts('00000000-0000-0000-0000-00000000dda1')
            where board_id = '00000000-0000-0000-0000-0000000b0a01'), 1,
  'every member sees that a Workspace is reachable from outside');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select is((select count(*)::int from public.list_board_share_counts('00000000-0000-0000-0000-00000000dda1')), 0,
  'board counts stay inside the caller''s own workspaces');

-- ── public: scope on every resolver ────────────────────────────────────
set local role service_role;

select is((select scope from public.open_project_share(repeat('b1', 32))), 'board',
  'the page knows it shows a Workspace');
select is((select board_name from public.open_project_share(repeat('b1', 32))), 'Kyiv',
  'and which one');
select is((select file_count from public.open_project_share(repeat('b1', 32))), 2,
  'and counts its files, not the project''s');
select is((select file_count from public.open_project_share(repeat('5e', 32))), 2,
  'a list page counts the list');
select is((select board_name from public.open_project_share(repeat('5e', 32))), null::text,
  'a list names no Workspace');
select is((select file_count from public.open_project_share(repeat('a1', 32))), 3,
  'a project link still counts the whole project');

select results_eq(
  $$select id from public.list_project_share_assets(repeat('b1', 32), null, null, 50) order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f2'::uuid)$$,
  'a Workspace link lists its live members and nothing else');
select results_eq(
  $$select id from public.list_project_share_assets(repeat('5e', 32), null, null, 50) order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f3'::uuid)$$,
  'a list link lists its list');
select is((select count(*)::int from public.resolve_project_share_media(repeat('b1', 32),
            '00000000-0000-0000-0000-0000000000f3', 'thumb')), 0,
  'a project file outside the Workspace is unreachable through its link');
select is((select count(*)::int from public.resolve_project_share_media(repeat('5e', 32),
            '00000000-0000-0000-0000-0000000000f2', 'thumb')), 0,
  'a project file outside the list is unreachable through it');
select is((select r2_key from public.resolve_project_share_media(repeat('b1', 32),
            '00000000-0000-0000-0000-0000000000f1', 'thumb')),
  '00000000-0000-0000-0000-00000000aaaa/previews/f1/thumb.webp', 'a member resolves as before');
select throws_ok(
  $$select * from public.enqueue_project_share_download(repeat('b1', 32), jsonb_build_object(
      'asset_ids', jsonb_build_array('00000000-0000-0000-0000-0000000000f3'),
      'options', jsonb_build_object('format', 'zip')))$$,
  '22023', 'project_share_download_empty', 'a ZIP of files outside the scope is refused');

insert into t_jobs
select 'board', job_id
  from public.enqueue_project_share_download(repeat('b1', 32), jsonb_build_object(
    'asset_ids', jsonb_build_array('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f1'),
    'options', jsonb_build_object('format', 'zip')));
reset role;
select is((select payload -> 'asset_ids' from public.ai_jobs where id = (select id from t_jobs where name = 'board')),
  '["00000000-0000-0000-0000-0000000000f1"]'::jsonb,
  'a ZIP carries only the requested ids that are in the scope');
set local role service_role;

-- ── public: details are opt-in, and SQL enforces it ────────────────────
select is((select label from public.list_project_share_assets(repeat('b1', 32), null, null, 50)
            where id = '00000000-0000-0000-0000-0000000000f1'), null::text,
  'a label is null unless the link shows labels');
select is((select tags from public.list_project_share_assets(repeat('b1', 32), null, null, 50)
            where id = '00000000-0000-0000-0000-0000000000f1'), null::text[],
  'tags are null unless the link shows tags');
select is((select caption from public.list_project_share_assets(repeat('b1', 32), null, null, 50)
            where id = '00000000-0000-0000-0000-0000000000f1'), null::text,
  'a caption is null unless the link shows one');
select is((select label from public.list_project_share_assets(repeat('d1', 32), null, null, 50)
            where id = '00000000-0000-0000-0000-0000000000f1'), 'red',
  'a link that shows labels carries them');
select is((select tags from public.list_project_share_assets(repeat('d1', 32), null, null, 50)
            where id = '00000000-0000-0000-0000-0000000000f1'), array['bridge', 'river']::text[],
  'tags are names, once each across categories');
select is((select caption from public.list_project_share_assets(repeat('d1', 32), null, null, 50)
            where id = '00000000-0000-0000-0000-0000000000f1'), 'A bridge over the river.',
  'the caption is the chosen language and style, not another');
select is((select caption from public.list_project_share_assets(repeat('d1', 32), null, null, 50)
            where id = '00000000-0000-0000-0000-0000000000f2'), null::text,
  'a file without that caption shows none');

select throws_ok(
  $$select * from public.list_project_share_assets(repeat('b1', 32), null, null, 50, p_label => 'red')$$,
  '22023', 'invalid_project_share_filter', 'a filter on a detail that is off is refused, not answered');
select throws_ok(
  $$select * from public.list_project_share_assets(repeat('5e', 32), null, null, 50,
      p_board_id => '00000000-0000-0000-0000-0000000b0a01')$$,
  '22023', 'invalid_project_share_filter', 'a list link has no Workspace filter');
select throws_ok(
  $$select * from public.list_project_share_assets(repeat('d1', 32), null, null, 50,
      p_board_id => '00000000-0000-0000-0000-0000000b0a02')$$,
  '22023', 'invalid_project_share_filter', 'a Workspace of another project is no filter');
select throws_ok(
  $$select * from public.list_project_share_assets(repeat('d1', 32), null, null, 50, p_label => 'pink')$$,
  '22023', 'invalid_project_share_filter', 'only the seven colours filter');
select results_eq(
  $$select id from public.list_project_share_assets(repeat('d1', 32), null, null, 50, p_label => 'red') order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f3'::uuid)$$,
  'filtering by a colour keeps the live files that carry it');
select results_eq(
  $$select id from public.list_project_share_assets(repeat('d1', 32), null, null, 50, p_tag => 'river') order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f2'::uuid)$$,
  'filtering by a tag name matches it in any category');
select results_eq(
  $$select id from public.list_project_share_assets(repeat('d1', 32), null, null, 50,
      p_board_id => '00000000-0000-0000-0000-0000000b0a01') order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f2'::uuid)$$,
  'filtering by a Workspace narrows a project link to it');

select is((select count(*)::int from public.list_project_share_facets(repeat('b1', 32))), 0,
  'a link with no details has no filter row');
select results_eq(
  $$select name, file_count from public.list_project_share_facets(repeat('d1', 32)) where facet = 'board'$$,
  $$values ('Kyiv'::text, 2), ('Lviv'::text, 1)$$,
  'Workspaces list in their own order with live counts');
select results_eq(
  $$select value, file_count from public.list_project_share_facets(repeat('d1', 32)) where facet = 'label'$$,
  $$values ('red'::text, 2)$$,
  'colours count live files only (not Trash)');
select results_eq(
  $$select value, file_count from public.list_project_share_facets(repeat('d1', 32)) where facet = 'tag'$$,
  $$values ('river'::text, 2), ('bridge'::text, 1)$$,
  'tags are counted per file, most-used first');

-- ── a Workspace link follows membership; a list never grows ────────────
reset role;
delete from public.board_assets
 where board_id = '00000000-0000-0000-0000-0000000b0a01'
   and asset_id = '00000000-0000-0000-0000-0000000000f2';
insert into public.assets (id, workspace_id, kind, title, status) values
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'late.jpg', 'active');
insert into public.project_assets (project_id, asset_id) values
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f7');
insert into public.board_assets (board_id, asset_id, position) values
  ('00000000-0000-0000-0000-0000000b0a01', '00000000-0000-0000-0000-0000000000f7', 3);
set local role service_role;

select results_eq(
  $$select id from public.list_project_share_assets(repeat('b1', 32), null, null, 50) order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f7'::uuid)$$,
  'a Workspace link follows its membership both ways');
select results_eq(
  $$select id from public.list_project_share_assets(repeat('5e', 32), null, null, 50) order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid), ('00000000-0000-0000-0000-0000000000f3'::uuid)$$,
  'a list never grows');

reset role;
update public.assets set status = 'deleted' where id = '00000000-0000-0000-0000-0000000000f1';
set local role service_role;
select results_eq(
  $$select id from public.list_project_share_assets(repeat('5e', 32), null, null, 50) order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f3'::uuid)$$,
  'a listed file in Trash leaves the link at once');
reset role;
update public.assets set status = 'active' where id = '00000000-0000-0000-0000-0000000000f1';
set local role service_role;
select is((select count(*)::int from public.list_project_share_assets(repeat('5e', 32), null, null, 50)), 2,
  'and comes back with Restore');

-- ── uploads through a Workspace link land in the Workspace ─────────────
insert into t_res
select 'new', id
  from public.reserve_project_share_uploads(repeat('b1', 32), 'Olena',
    '[{"filename":"new.jpg","key_name":"new.jpg","mime":"image/jpeg","bytes":10}]'::jsonb);
select is((select count(*)::int from public.claim_project_share_uploads(repeat('b1', 32),
            array(select id from t_res))), 1, 'a Workspace link reserves and claims like any upload link');
select results_eq(
  $$select status from public.complete_project_share_uploads(repeat('b1', 32),
      jsonb_build_array(jsonb_build_object('id', (select id from t_res where name = 'new'), 'ok', true, 'actual_bytes', 10)),
      array(select id from t_res))$$,
  $$values ('completed'::text)$$,
  'and completes');
reset role;
select is((select count(*)::int
             from public.board_assets ba
             join public.assets a on a.id = ba.asset_id
            where ba.board_id = '00000000-0000-0000-0000-0000000b0a01'
              and a.received_share_id = (select id from t_links where name = 'board')), 1,
  'the received file is a member of the Workspace');
select is((select ba.position
             from public.board_assets ba
             join public.assets a on a.id = ba.asset_id
            where ba.board_id = '00000000-0000-0000-0000-0000000b0a01'
              and a.received_share_id = (select id from t_links where name = 'board')), 4,
  'appended after the Workspace''s last member');
select is((select count(*)::int
             from public.project_assets pa
             join public.assets a on a.id = pa.asset_id
            where pa.project_id = '00000000-0000-0000-0000-00000000dda1'
              and a.received_share_id = (select id from t_links where name = 'board')), 1,
  'and of the project');

-- ── a Workspace's Trash pauses its links; Restore resumes them ─────────
update public.boards set deleted_at = now() where id = '00000000-0000-0000-0000-0000000b0a01';
set local role service_role;
select is((select count(*)::int from public.open_project_share(repeat('b1', 32))), 0,
  'a Workspace in Trash closes its links');
select is((select count(*)::int from public.resolve_project_share_media(repeat('b1', 32),
            '00000000-0000-0000-0000-0000000000f1', 'thumb')), 0,
  'down to every file');
select is((select count(*)::int from public.list_project_share_facets(repeat('d1', 32)) where facet = 'board'), 1,
  'a Workspace in Trash leaves a project link''s filter row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is((select status from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'board')), 'inactive',
  'the editor sees it paused, not gone');
select is((select live_count from public.list_project_share_counts()
            where project_id = '00000000-0000-0000-0000-00000000dda1'), 3,
  'and the project card stops counting it');
select is((select count(*)::int from public.list_board_share_counts('00000000-0000-0000-0000-00000000dda1')), 0,
  'as does the Workspace chip');

reset role;
update public.boards set deleted_at = null where id = '00000000-0000-0000-0000-0000000b0a01';
set local role service_role;
select is((select count(*)::int from public.open_project_share(repeat('b1', 32))), 1,
  'Restore reopens the same link');

reset role;
delete from public.boards where id = '00000000-0000-0000-0000-0000000b0a01';
select is((select board_id from public.project_shares where id = (select id from t_links where name = 'board')),
  null::uuid, 'deleting a Workspace for good keeps the link row and its ledger');
select is((select count(*)::int from public.assets
            where received_share_id = (select id from t_links where name = 'board')), 1,
  'and the provenance of what arrived through it');
set local role service_role;
select is((select count(*)::int from public.open_project_share(repeat('b1', 32))), 0,
  'but the link is dead');

select * from finish();
rollback;
