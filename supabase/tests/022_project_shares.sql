-- Project share links (pgTAP) — run: `supabase test db`.
-- Covers migration 20261103000001 / ADR 0051: editor-only creation with fixed
-- expiries and per-link rights, hash-only lookup with an optional ciphertext,
-- service-role-only public resolvers, one liveness rule (revoked, expired,
-- project in Trash, author no longer an editor), project and tenant isolation,
-- structural key-prefix checks, upload quota, single-winner claims, idempotent
-- completion with provenance, ZIP guards and reuse, and the two-phase sweep.
begin;
create extension if not exists pgtap with schema extensions;
select plan(101);

-- ── fixtures (superuser) ────────────────────────────────────────────────
-- R2 keys use the REAL §6 layout `{workspace_id}/…`: resolvers refuse any key
-- outside the share's own workspace prefix, so a readable stand-in would make
-- every media assertion here fail for the wrong reason.
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
insert into public.workspaces (id, name, created_by, creator, credit, copyright_notice, usage_terms) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1',
   'Photographer A', 'Photo: A', '© A', 'Editorial use only'),
  ('00000000-0000-0000-0000-00000000bbbb', 'WS-B', '00000000-0000-0000-0000-0000000000b4',
   'Photographer B', null, null, null);
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

-- f1 stored original · f2 Drive (no original, edited) · f3 other project ·
-- f4 in Trash · f5 a row pointing at ANOTHER tenant's key · fb other workspace.
insert into public.assets (id, workspace_id, kind, title, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'original.jpg', 'active'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'drive.jpg', 'active'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'elsewhere.jpg', 'active'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'trashed.jpg', 'deleted'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'crossed.jpg', 'active'),
  ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'foreign.jpg', 'active');
insert into public.project_assets (project_id, asset_id) values
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-00000000dda2', '00000000-0000-0000-0000-0000000000f3'),
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f4'),
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f5'),
  ('00000000-0000-0000-0000-00000000ddb2', '00000000-0000-0000-0000-0000000000fb');
insert into public.asset_previews (asset_id, size, r2_key, width, height) values
  ('00000000-0000-0000-0000-0000000000f1', 'thumb', '00000000-0000-0000-0000-00000000aaaa/previews/f1/thumb.webp', 256, 171),
  ('00000000-0000-0000-0000-0000000000f1', 'medium', '00000000-0000-0000-0000-00000000aaaa/previews/f1/medium.webp', 1024, 683),
  ('00000000-0000-0000-0000-0000000000f2', 'medium', '00000000-0000-0000-0000-00000000aaaa/previews/f2/medium.webp', 683, 1024),
  ('00000000-0000-0000-0000-0000000000f3', 'medium', '00000000-0000-0000-0000-00000000aaaa/previews/f3/medium.webp', 1024, 1024),
  ('00000000-0000-0000-0000-0000000000fb', 'medium', '00000000-0000-0000-0000-00000000bbbb/previews/fb/medium.webp', 1024, 1024);
insert into public.asset_edits (asset_id, recipe, edited_medium_key) values
  ('00000000-0000-0000-0000-0000000000f2', '{}'::jsonb, '00000000-0000-0000-0000-00000000aaaa/edits/f2/medium.webp');
insert into public.files (asset_id, workspace_id, origin, r2_key, mime_type, byte_size) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'upload',
   '00000000-0000-0000-0000-00000000aaaa/originals/f1/original.jpg', 'image/jpeg', 5000000),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'gdrive', null, 'image/jpeg', null),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-00000000aaaa', 'upload',
   '00000000-0000-0000-0000-00000000bbbb/originals/fb/foreign.jpg', 'image/jpeg', 100),
  ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-00000000bbbb', 'upload',
   '00000000-0000-0000-0000-00000000bbbb/originals/fb/foreign.jpg', 'image/jpeg', 100);

-- Generated ids cross SET ROLE boundaries through these, created as the
-- superuser and granted to exactly the roles that write or read them.
create temporary table t_links (name text primary key, id uuid, expires_at timestamptz);
create temporary table t_res (name text primary key, id uuid, staging_key text);
create temporary table t_jobs (name text primary key, id uuid, reused boolean);
grant select, insert on table t_links, t_res, t_jobs to authenticated, service_role;

-- ── capability surface ─────────────────────────────────────────────────
select has_table('public', 'project_shares', 'project_shares exists');
select has_table('public', 'project_share_uploads', 'project_share_uploads exists');
select ok(not has_table_privilege('anon', 'public.project_shares', 'SELECT'),
  'anon has no direct read of project links');
select ok(not has_table_privilege('authenticated', 'public.project_shares', 'SELECT'),
  'signed-in clients cannot read digests or ciphertexts directly');
select ok(not has_table_privilege('authenticated', 'public.project_shares', 'INSERT'),
  'signed-in clients cannot mint a link around the RPC');
select ok(not has_table_privilege('authenticated', 'public.project_share_uploads', 'SELECT'),
  'the upload ledger is private infrastructure');
select ok(not has_function_privilege('anon',
  'public.create_project_share(uuid,boolean,boolean,integer,text,text,text)', 'EXECUTE'),
  'anon cannot mint links');
select ok(has_function_privilege('authenticated',
  'public.create_project_share(uuid,boolean,boolean,integer,text,text,text)', 'EXECUTE'),
  'editors reach creation, which checks its own role');
select ok(not has_function_privilege('anon', 'public.list_project_shares(uuid)', 'EXECUTE'),
  'anon cannot enumerate a project''s links');
select ok(not has_function_privilege('anon', 'public.open_project_share(text)', 'EXECUTE'),
  'anon cannot bypass the Next page to reach the resolver');
select ok(not has_function_privilege('authenticated', 'public.open_project_share(text)', 'EXECUTE'),
  'neither can a signed-in client');
select ok(has_function_privilege('service_role', 'public.open_project_share(text)', 'EXECUTE'),
  'the fenced integration may open a link');
select ok(not has_function_privilege('anon', 'public.resolve_project_share_media(text,uuid,text)', 'EXECUTE'),
  'anon cannot fetch an object key');
select ok(not has_function_privilege('authenticated', 'public.reserve_project_share_uploads(text,text,jsonb)', 'EXECUTE'),
  'nobody but the server reserves upload room');
select ok(not has_function_privilege('anon', 'public.complete_project_share_uploads(text,jsonb,uuid[])', 'EXECUTE'),
  'nobody but the server completes uploads');
select ok(not has_function_privilege('authenticated', 'public.enqueue_project_share_download(text,jsonb)', 'EXECUTE'),
  'nobody but the server queues a link ZIP');
select ok(not has_function_privilege('authenticated', 'public.project_share_uploads_to_sweep(integer)', 'EXECUTE'),
  'the sweep is not a client API');
select ok(not has_function_privilege('anon', 'public.project_share_by_token(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.project_share_by_token(text)', 'EXECUTE'),
  'the liveness helper returns whole rows and is no API at all');

-- ── creation: role, rights, expiry, tenancy ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('c3', 32), null)$$,
  '42501', 'project_share_editor_required', 'a viewer cannot share a project');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 14, null,
    repeat('c3', 32), null)$$,
  '22023', 'invalid_project_share_expiry', 'expiry is one of 1, 7, 30 or 90 days');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', false, false, 7, null,
    repeat('c3', 32), null)$$,
  '22023', 'invalid_project_share_rights', 'a link must carry at least one right');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000ddb2', true, false, 7, null,
    repeat('c3', 32), null)$$,
  '42501', 'project_share_editor_required', 'an editor cannot share another workspace''s project');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    'not-a-digest', null)$$,
  '22023', 'invalid_project_share_token_hash', 'only a SHA-256 digest is accepted');

insert into t_links
select 'download', id, expires_at
  from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, '  Desk  ',
    repeat('a1', 32), 'v1:iv:ct:tag');
insert into t_links
select 'both', id, expires_at
  from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, true, 30, null,
    repeat('c3', 32), null);
insert into t_links
select 'editor-own', id, expires_at
  from public.create_project_share('00000000-0000-0000-0000-00000000dda1', false, true, 1, null,
    repeat('d4', 32), null);

select ok(
  (select expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days'
     from t_links where name = 'download'),
  'a 7-day link expires seven days from now');
select throws_ok(
  $$select * from public.create_project_share('00000000-0000-0000-0000-00000000dda1', true, false, 7, null,
    repeat('a1', 32), null)$$,
  '23505', null, 'a digest can never be reused');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into t_links
select 'upload', id, expires_at
  from public.create_project_share('00000000-0000-0000-0000-00000000dda1', false, true, 90, 'Client drop',
    repeat('b2', 32), 'v1:iv:ct:tag2');

reset role;
select is((select label from public.project_shares where id = (select id from t_links where name = 'download')),
  'Desk', 'labels are trimmed');
select is((select created_by from public.project_shares where id = (select id from t_links where name = 'upload')),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'the creator is the caller, never a parameter');

-- ── editor-side listing and counts ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

select is((select count(*)::int from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')), 4,
  'an editor sees every unrevoked link of the project');
select is((select status from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'download')), 'live',
  'a fresh link is live');
select is((select token_ciphertext from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'download')), 'v1:iv:ct:tag',
  'a live link hands its ciphertext back so the route can rebuild the URL');
select is((select created_by_name from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'upload')), 'Owner A',
  'the list names who made each link');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select throws_ok(
  $$select * from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')$$,
  '42501', 'project_share_editor_required', 'a viewer cannot list links or their ciphertexts');
select is((select live_count from public.list_project_share_counts()
            where project_id = '00000000-0000-0000-0000-00000000dda1'), 4,
  'every member sees that the project is reachable from outside');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select is((select count(*)::int from public.list_project_share_counts()), 0,
  'counts stay inside the caller''s own workspaces');

-- ── public page + listing (service role) ───────────────────────────────
set local role service_role;

select is((select count(*)::int from public.open_project_share('zz')), 0,
  'a malformed token opens nothing');
select is((select count(*)::int from public.open_project_share(repeat('e5', 32))), 0,
  'an unknown digest opens nothing');
select is((select project_name from public.open_project_share(repeat('a1', 32))), 'Odesa',
  'a live link opens its project');
select is((select file_count from public.open_project_share(repeat('a1', 32))), 3,
  'the count covers live files of this project only (not Trash, not other projects)');
select is((select rights ->> 'credit' from public.open_project_share(repeat('a1', 32))), 'Photo: A',
  'the page carries the workspace byline');
select is((select file_count from public.open_project_share(repeat('b2', 32))), null::int,
  'an upload-only link learns no file count');
select is((select max_files from public.open_project_share(repeat('b2', 32))), 2000,
  'an upload link states its quota');

select results_eq(
  $$select id from public.list_project_share_assets(repeat('a1', 32), null, null, 50) order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000f1'::uuid),
           ('00000000-0000-0000-0000-0000000000f2'::uuid),
           ('00000000-0000-0000-0000-0000000000f5'::uuid)$$,
  'the listing is this project''s live files and nothing else');
select is((select count(*)::int from public.list_project_share_assets(repeat('b2', 32), null, null, 50)), 0,
  'an upload-only link lists nothing');
select is((select has_original from public.list_project_share_assets(repeat('a1', 32), null, null, 50)
            where id = '00000000-0000-0000-0000-0000000000f2'), false,
  'a Drive file says it has no stored original');
select throws_ok(
  $$select * from public.list_project_share_assets(repeat('a1', 32), null, null, 0)$$,
  '22023', 'invalid_project_share_page', 'pages are 1..200 rows');
select is((select count(*)::int from public.list_project_share_assets(
            repeat('a1', 32),
            (select sort_at from public.list_project_share_assets(repeat('a1', 32), null, null, 1)),
            (select id from public.list_project_share_assets(repeat('a1', 32), null, null, 1)),
            50)), 2,
  'the keyset cursor continues after the last row it was given');

-- ── media resolution ───────────────────────────────────────────────────
select is((select quality from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f1', 'original')), 'original',
  'a stored original downloads as itself');
select is((select r2_key from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f2', 'original')),
  '00000000-0000-0000-0000-00000000aaaa/edits/f2/medium.webp',
  'a Drive file downloads as its (edited) web-size preview');
select is((select filename from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f2', 'original')), 'drive.webp',
  'and is named for what it is');
select is((select r2_key from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f1', 'thumb')),
  '00000000-0000-0000-0000-00000000aaaa/previews/f1/thumb.webp', 'thumbnails resolve per request');
select is((select count(*)::int from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f3', 'thumb')), 0,
  'a file of another project of the same workspace is unreachable');
select is((select count(*)::int from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000fb', 'original')), 0,
  'a file of another workspace is unreachable');
select is((select count(*)::int from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f4', 'original')), 0,
  'a file in Trash leaves the link at once');
select is((select count(*)::int from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f5', 'original')), 0,
  'a key outside the share''s own workspace prefix is never signed');
select is((select count(*)::int from public.resolve_project_share_media(repeat('b2', 32),
            '00000000-0000-0000-0000-0000000000f1', 'thumb')), 0,
  'an upload-only link cannot see a single thumbnail');
select is((select count(*)::int from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f1', 'raw')), 0,
  'only thumb, medium and original exist');

reset role;
select is((select download_count from public.project_shares
            where id = (select id from t_links where name = 'download')), 3,
  'downloads are counted; thumbnails are not');

-- ── uploads: reserve → claim → complete ────────────────────────────────
set local role service_role;

select is((select count(*)::int from public.reserve_project_share_uploads(repeat('a1', 32), null,
            '[{"filename":"a.jpg","key_name":"a.jpg","mime":"image/jpeg","bytes":10}]'::jsonb)), 0,
  'a download-only link cannot receive files');
select throws_ok(
  $$select * from public.reserve_project_share_uploads(repeat('b2', 32), null,
    '[{"filename":"a.jpg","key_name":"../a.jpg","mime":"image/jpeg","bytes":10}]'::jsonb)$$,
  '22023', 'invalid_project_share_upload', 'a key name is the sanitized subset only');
select throws_ok(
  $$select * from public.reserve_project_share_uploads(repeat('b2', 32), null,
    '[{"filename":"big.mov","key_name":"big.mov","mime":"video/quicktime","bytes":104857601}]'::jsonb)$$,
  '22023', 'invalid_project_share_upload', 'one file is at most the single-PUT limit');

insert into t_res
select id::text, id, staging_key
  from public.reserve_project_share_uploads(repeat('b2', 32), '  Ivan  ',
    '[{"filename":"good.jpg","key_name":"good.jpg","mime":"image/jpeg","bytes":1000},
      {"filename":"short.jpg","key_name":"short.jpg","mime":"image/jpeg","bytes":2000}]'::jsonb);

select is((select count(*)::int from t_res), 2, 'room is reserved per file');
select ok((select bool_and(staging_key like '00000000-0000-0000-0000-00000000aaaa/incoming/%') from t_res),
  'the browser writes only to a tenant-prefixed staging key');

reset role;
update t_res set name = split_part(psu.filename, '.', 1)
  from public.project_share_uploads psu where psu.id = t_res.id;
update public.project_shares set max_files = 3 where id = (select id from t_links where name = 'upload');
set local role service_role;
select throws_ok(
  $$select * from public.reserve_project_share_uploads(repeat('b2', 32), null,
    '[{"filename":"c.jpg","key_name":"c.jpg","mime":"image/jpeg","bytes":10},
      {"filename":"d.jpg","key_name":"d.jpg","mime":"image/jpeg","bytes":10}]'::jsonb)$$,
  '53400', 'project_share_upload_quota', 'open reservations count against the quota');

select is((select count(*)::int from public.claim_project_share_uploads(repeat('b2', 32),
            array(select id from t_res))), 2, 'the first request claims both reservations');
select is((select count(*)::int from public.claim_project_share_uploads(repeat('b2', 32),
            array(select id from t_res))), 0, 'a concurrent request claims none: one copier per file');
select is((select count(*)::int from public.claim_project_share_uploads(repeat('a1', 32),
            array(select id from t_res))), 0, 'another link cannot claim them');

select results_eq(
  $$select status from public.complete_project_share_uploads(repeat('b2', 32),
      jsonb_build_array(
        jsonb_build_object('id', (select id from t_res where name = 'good'), 'ok', true, 'actual_bytes', 1000),
        jsonb_build_object('id', (select id from t_res where name = 'short'), 'ok', true, 'actual_bytes', 1999)),
      array(select id from t_res order by name))
    order by status$$,
  $$values ('completed'::text), ('rejected'::text)$$,
  'a verified size completes; a size that differs from the declared one is rejected');

reset role;
select is((select count(*)::int from public.assets
            where received_share_id = (select id from t_links where name = 'upload')), 1,
  'one asset for one accepted file');
select is((select received_from from public.assets
            where received_share_id = (select id from t_links where name = 'upload')), 'Ivan',
  'the asset records who sent it');
select is((select added_by from public.assets
            where received_share_id = (select id from t_links where name = 'upload')), null::uuid,
  'no workspace member is credited with adding it');
select ok(exists (
    select 1 from public.project_assets pa
      join public.assets a on a.id = pa.asset_id
     where a.received_share_id = (select id from t_links where name = 'upload')
       and pa.project_id = '00000000-0000-0000-0000-00000000dda1'),
  'it lands in the shared project');
select is((select f.r2_key from public.files f
             join public.assets a on a.id = f.asset_id
            where a.received_share_id = (select id from t_links where name = 'upload')),
  (select final_key from public.project_share_uploads where id = (select id from t_res where name = 'good')),
  'its file points at the server-written final key, never the staging key');
select is((select count(*)::int from public.ai_jobs
            where type = 'ingest'
              and payload ->> 'share_id' = (select id from t_links where name = 'upload')::text
              and user_id is null), 1,
  'one ingest job, with share provenance and no member as its user');

set local role service_role;
select results_eq(
  $$select status from public.complete_project_share_uploads(repeat('b2', 32), '[]'::jsonb,
      array(select id from t_res order by name)) order by status$$,
  $$values ('completed'::text), ('rejected'::text)$$,
  'a retry after a lost response learns the outcome without redoing it');
reset role;
select is((select count(*)::int from public.assets
            where received_share_id = (select id from t_links where name = 'upload')), 1,
  'the retry created nothing');
set local role service_role;
select is((select used_files from public.open_project_share(repeat('b2', 32))), 1,
  'a rejected file gives its room back');

-- ── downloads: one ZIP through the export job ──────────────────────────
insert into t_jobs
select 'first', job_id, reused
  from public.enqueue_project_share_download(repeat('a1', 32), jsonb_build_object(
    'asset_ids', jsonb_build_array(
      '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3',
      '00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000f1',
      '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f4'),
    'title', 'Odesa',
    'options', jsonb_build_object('format', 'zip', 'zipContents', 'originals')));

reset role;
select is((select payload -> 'asset_ids' from public.ai_jobs where id = (select id from t_jobs where name = 'first')),
  '["00000000-0000-0000-0000-0000000000f2", "00000000-0000-0000-0000-0000000000f1"]'::jsonb,
  'a ZIP carries only live files of this project, deduplicated, in the order asked');
select ok((select user_id is null and project_id is null and payload ->> 'share_id' is not null
             from public.ai_jobs where id = (select id from t_jobs where name = 'first')),
  'the job names its link and no member, and leaves project_id (an FK with no delete action) alone');

set local role service_role;
select throws_ok(
  $$select * from public.enqueue_project_share_download(repeat('a1', 32), jsonb_build_object(
      'asset_ids', jsonb_build_array('00000000-0000-0000-0000-0000000000f1'),
      'options', jsonb_build_object('format', 'zip')))$$,
  '53400', 'project_share_download_busy', 'one ZIP in flight per link');
select throws_ok(
  $$select * from public.enqueue_project_share_download(repeat('c3', 32), jsonb_build_object(
      'asset_ids', jsonb_build_array('00000000-0000-0000-0000-0000000000f1'),
      'options', jsonb_build_object('format', 'pdf')))$$,
  '22023', 'invalid_project_share_download', 'a link downloads files, not documents');
select is((select count(*)::int from public.project_share_download_status(repeat('c3', 32),
            (select id from t_jobs where name = 'first'))), 0,
  'another link cannot read this link''s job');

reset role;
update public.ai_jobs
   set status = 'done', finished_at = now(),
       payload = payload || jsonb_build_object('result_key',
         '00000000-0000-0000-0000-00000000aaaa/exports/' || id::text || '.zip')
 where id = (select id from t_jobs where name = 'first');

set local role service_role;
select is((select result_key from public.project_share_download_status(repeat('a1', 32),
            (select id from t_jobs where name = 'first'))),
  '00000000-0000-0000-0000-00000000aaaa/exports/' || (select id from t_jobs where name = 'first')::text || '.zip',
  'the finished ZIP resolves for the link that asked for it');
insert into t_jobs
select 'again', job_id, reused
  from public.enqueue_project_share_download(repeat('a1', 32), jsonb_build_object(
    'asset_ids', jsonb_build_array(
      '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1'),
    'title', 'Odesa',
    'options', jsonb_build_object('format', 'zip', 'zipContents', 'originals')));
select ok((select reused and id = (select id from t_jobs where name = 'first') from t_jobs where name = 'again'),
  'an identical request reuses the ZIP that still exists');

reset role;
update public.ai_jobs
   set payload = jsonb_set(payload, '{result_key}', '"00000000-0000-0000-0000-00000000bbbb/exports/x.zip"')
 where id = (select id from t_jobs where name = 'first');
set local role service_role;
select is((select result_key from public.project_share_download_status(repeat('a1', 32),
            (select id from t_jobs where name = 'first'))), null::text,
  'a result key outside this workspace''s exports is never handed out');

-- ── management: extend, revoke, and every way a link dies ──────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok(
  $$select public.extend_project_share((select id from t_links where name = 'upload'), 30)$$,
  '42501', 'project_share_owner_required', 'an editor cannot widen someone else''s link');
select lives_ok(
  $$select public.revoke_project_share((select id from t_links where name = 'download'))$$,
  'but any editor can turn any link off');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select throws_ok(
  $$select public.revoke_project_share((select id from t_links where name = 'both'))$$,
  '42501', 'project_share_editor_required', 'a viewer cannot');

set local role service_role;
select is((select count(*)::int from public.open_project_share(repeat('a1', 32))), 0,
  'a link that was turned off opens nothing');
select is((select count(*)::int from public.resolve_project_share_media(repeat('a1', 32),
            '00000000-0000-0000-0000-0000000000f1', 'thumb')), 0,
  'and stops the very next image request');

reset role;
update public.project_shares set expires_at = now() - interval '1 second', created_at = now() - interval '2 days'
 where id = (select id from t_links where name = 'both');
set local role service_role;
select is((select count(*)::int from public.open_project_share(repeat('c3', 32))), 0,
  'an expired link opens nothing');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select status from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'both')), 'expired',
  'the list says which links expired');
select ok(public.extend_project_share((select id from t_links where name = 'both'), 7) > now(),
  'the owner can extend it, keeping its URL');
set local role service_role;
select is((select count(*)::int from public.open_project_share(repeat('c3', 32))), 1,
  'and it opens again');

reset role;
update public.memberships set role = 'viewer'
 where workspace_id = '00000000-0000-0000-0000-00000000aaaa'
   and user_id = '00000000-0000-0000-0000-0000000000e2';
set local role service_role;
select is((select count(*)::int from public.open_project_share(repeat('d4', 32))), 0,
  'a link dies with its author''s editor role');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select status from public.list_project_shares('00000000-0000-0000-0000-00000000dda1')
            where id = (select id from t_links where name = 'editor-own')), 'inactive',
  'and the list shows it as inactive, with no ciphertext to copy');

reset role;
update public.projects set deleted_at = now() where id = '00000000-0000-0000-0000-00000000dda1';
set local role service_role;
select is((select count(*)::int from public.open_project_share(repeat('b2', 32))), 0,
  'a project in Trash closes every link to it');
reset role;
update public.projects set deleted_at = null where id = '00000000-0000-0000-0000-00000000dda1';

-- ── sweep ──────────────────────────────────────────────────────────────
set local role service_role;
insert into t_res
select 'abandoned', id, staging_key
  from public.reserve_project_share_uploads(repeat('b2', 32), null,
    '[{"filename":"gone.jpg","key_name":"gone.jpg","mime":"image/jpeg","bytes":10}]'::jsonb);
reset role;
update public.project_share_uploads set created_at = now() - interval '3 hours'
 where id = (select id from t_res where name = 'abandoned');
update public.project_share_uploads set completed_at = now() - interval '1 hour'
 where id = (select id from t_res where name = 'good');

set local role service_role;
create temporary table t_sweep as select * from public.project_share_uploads_to_sweep(500);
reset role;
select is((select status from public.project_share_uploads where id = (select id from t_res where name = 'abandoned')),
  'expired', 'an abandoned reservation expires');
select ok((select final_key is not null from t_sweep where id = (select id from t_res where name = 'abandoned')),
  'both of its keys are handed to the worker');
select ok((select final_key is null from t_sweep where id = (select id from t_res where name = 'good')),
  'a completed upload hands over its staging key only — the final key is the asset''s original');
set local role service_role;
select is(public.mark_project_share_uploads_swept(array(select id from t_sweep)), 3,
  'swept rows are marked once their objects are gone');
select is((select count(*)::int from public.project_share_uploads_to_sweep(500)), 0,
  'and are not handed out again');

select * from finish();
rollback;
