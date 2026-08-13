-- Anonymous publication-share boundary (pgTAP) — run: `supabase test db`.
-- Covers migration 20260813000002 / ADR 0046: editor-only atomic creation,
-- private snapshots, hash-only bearer tokens, preparing → ready activation,
-- server-only public projections, per-request preview resolution independent of
-- download gating, editor-only link status without a token, revocation/expiry,
-- tenant and board-asset isolation, asset-trash invalidation, and board
-- deletion survival.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

-- ── fixtures (superuser) ────────────────────────────────────────────────
-- R2 keys here use the REAL §6 layout, `{workspace_id}/originals/…`, not a
-- readable stand-in: creation refuses an `original` download key that does not
-- sit under the calling workspace's own originals prefix, so a prettier fixture
-- key would make every publication in this file fail validation.
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
insert into public.workspaces
  (id, name, created_by, creator, credit, copyright_notice, usage_terms)
values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A',
   '00000000-0000-0000-0000-0000000000a1', 'Photographer A',
   'Photo: A / ArchiveMind', '© A', 'Editorial use only'),
  ('00000000-0000-0000-0000-00000000bbbb', 'WS-B',
   '00000000-0000-0000-0000-0000000000b4', 'Photographer B',
   'Photo: B', '© B', null);
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
   '00000000-0000-0000-0000-00000000dda1', 'Text only', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-00000000bbbb',
   '00000000-0000-0000-0000-00000000ddb2', 'Foreign', '00000000-0000-0000-0000-0000000000b4');

insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'original.jpg'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'drive.jpg'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'not-on-board.jpg'),
  ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'foreign.jpg');
insert into public.project_assets (project_id, asset_id) values
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f3'),
  ('00000000-0000-0000-0000-00000000ddb2', '00000000-0000-0000-0000-0000000000fb');
insert into public.board_assets (board_id, asset_id, position) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 0),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', 1),
  ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-0000000000fb', 0);
insert into public.asset_previews (asset_id, size, r2_key, width, height) values
  ('00000000-0000-0000-0000-0000000000f1', 'medium', '00000000-0000-0000-0000-00000000aaaa/previews/f1/medium.webp', 1200, 800),
  ('00000000-0000-0000-0000-0000000000f2', 'medium', '00000000-0000-0000-0000-00000000aaaa/previews/f2/medium.webp', 800, 1200),
  ('00000000-0000-0000-0000-0000000000f3', 'medium', '00000000-0000-0000-0000-00000000aaaa/previews/f3/medium.webp', 1000, 1000),
  ('00000000-0000-0000-0000-0000000000fb', 'medium', '00000000-0000-0000-0000-00000000bbbb/previews/fb/medium.webp', 1000, 1000);
insert into public.asset_edits (asset_id, recipe, edited_medium_key) values
  ('00000000-0000-0000-0000-0000000000f2', '{}'::jsonb, '00000000-0000-0000-0000-00000000aaaa/edits/f2/medium.webp');
insert into public.files (id, asset_id, workspace_id, origin, r2_key, mime_type) values
  ('20000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-00000000aaaa', 'upload', '00000000-0000-0000-0000-00000000aaaa/originals/f1/original.jpg', 'image/jpeg'),
  ('20000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-00000000aaaa', 'gdrive', null, 'image/jpeg'),
  ('20000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000fb',
   '00000000-0000-0000-0000-00000000bbbb', 'upload', '00000000-0000-0000-0000-00000000bbbb/originals/fb/foreign.jpg', 'image/jpeg');

-- Capture generated share ids/copy plans across SET ROLE boundaries. Create
-- these as the test superuser and grant only the access each simulated API role
-- needs; a temp table created while SET ROLE authenticated would otherwise be
-- unreadable after switching to service_role for the resolver assertions.
create temporary table created_publication (
  id uuid, created_at timestamptz, expires_at timestamptz, copy_plan jsonb
);
create temporary table revoked_publication (id uuid, preview_r2_keys jsonb);
create temporary table text_publication (
  id uuid, created_at timestamptz, expires_at timestamptz, copy_plan jsonb
);
create temporary table asset_publication (
  id uuid, created_at timestamptz, expires_at timestamptz, copy_plan jsonb
);
create temporary table expiring_publication (
  id uuid, created_at timestamptz, expires_at timestamptz, copy_plan jsonb
);
create temporary table no_download_publication (
  id uuid, created_at timestamptz, expires_at timestamptz, copy_plan jsonb
);
grant select, insert on table
  created_publication, revoked_publication, text_publication,
  asset_publication, expiring_publication, no_download_publication
to authenticated, service_role;

-- ── schema and capability surface ─────────────────────────────────────
select has_table('public', 'publication_shares', 'publication_shares exists');
select has_table('public', 'publication_share_assets', 'publication_share_assets exists');
select has_column('public', 'publication_shares', 'token_hash', 'only a token hash has a storage column');
select ok(not has_table_privilege('anon', 'public.publication_shares', 'SELECT'),
  'anon has no direct share-table read');
select ok(not has_table_privilege('authenticated', 'public.publication_shares', 'SELECT'),
  'authenticated has no direct share-table read');
select ok(not has_table_privilege('authenticated', 'public.publication_shares', 'INSERT'),
  'authenticated has no direct share-table write');
select ok(not has_function_privilege(
  'anon',
  'public.create_publication_share(uuid,text,text,text,jsonb,text,timestamp with time zone,boolean,jsonb)',
  'EXECUTE'), 'anon cannot call the creation RPC');
select ok(has_function_privilege(
  'authenticated',
  'public.create_publication_share(uuid,text,text,text,jsonb,text,timestamp with time zone,boolean,jsonb)',
  'EXECUTE'), 'authenticated can reach creation, which performs its own editor checks');
select ok(not has_function_privilege('anon', 'public.resolve_publication_share(text)', 'EXECUTE'),
  'anon cannot bypass the Next server to retrieve internal preview keys');
select ok(not has_function_privilege('authenticated', 'public.resolve_publication_share(text)', 'EXECUTE'),
  'authenticated clients cannot bypass the Next server projection either');
select ok(has_function_privilege('service_role', 'public.resolve_publication_share(text)', 'EXECUTE'),
  'the fenced server integration may invoke the snapshot resolver');
select ok(not has_function_privilege('anon', 'public.resolve_publication_share_asset(text,uuid)', 'EXECUTE'),
  'anon cannot retrieve an internal download key directly');
select ok(not has_function_privilege('anon', 'public.resolve_publication_share_preview(text,uuid)', 'EXECUTE'),
  'anon cannot retrieve an internal preview key directly');
select ok(not has_function_privilege('authenticated', 'public.resolve_publication_share_preview(text,uuid)', 'EXECUTE'),
  'a signed-in client cannot bypass the per-request preview projection either');
select ok(has_function_privilege('authenticated', 'public.list_publication_shares(uuid)', 'EXECUTE'),
  'authors reach their own link status, which performs its own editor check');
select ok(not has_function_privilege('anon', 'public.list_publication_shares(uuid)', 'EXECUTE'),
  'anon cannot enumerate a workspace''s live publications');

-- ── viewer and tenant gates ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select throws_ok(
  $$select * from public.create_publication_share(
    '00000000-0000-0000-0000-0000000000e1', 'viewer-draft', 'article', 'Viewer',
    '{"schemaVersion":1,"kind":"article","name":"Viewer","publicAssetIds":[],"content":{}}'::jsonb,
    repeat('1',64), null, true, '[]'::jsonb)$$,
  '42501', 'publication_editor_required', 'a viewer cannot publish');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok(
  $$select * from public.create_publication_share(
    '00000000-0000-0000-0000-0000000000eb', 'foreign-draft', 'article', 'Foreign',
    '{"schemaVersion":1,"kind":"article","name":"Foreign","publicAssetIds":[],"content":{}}'::jsonb,
    repeat('2',64), null, true, '[]'::jsonb)$$,
  '42501', 'publication_editor_required', 'an editor cannot publish a foreign board');

select throws_ok(
  $$select * from public.create_publication_share(
    '00000000-0000-0000-0000-0000000000e1', 'private-draft', 'article', 'Private',
    '{"schemaVersion":1,"kind":"article","name":"Private","boardId":"00000000-0000-0000-0000-0000000000e1","publicAssetIds":[],"content":{}}'::jsonb,
    repeat('3',64), null, true, '[]'::jsonb)$$,
  '22023', 'publication_snapshot_private', 'private editor keys cannot enter a public snapshot');

select throws_ok(
  $$select * from public.create_publication_share(
    '00000000-0000-0000-0000-0000000000e1', 'bad-map', 'article', 'Bad map',
    '{"schemaVersion":1,"kind":"article","name":"Bad map","publicAssetIds":["10000000-0000-0000-0000-000000000001"],"content":{}}'::jsonb,
    repeat('4',64), null, true, '[]'::jsonb)$$,
  '22023', 'publication_asset_map_mismatch', 'snapshot public ids must exactly match ordered media rows');

select throws_ok(
  $$select * from public.create_publication_share(
    '00000000-0000-0000-0000-0000000000e1', 'missing-member', 'article', 'Missing member',
    '{"schemaVersion":1,"kind":"article","name":"Missing member","publicAssetIds":["10000000-0000-0000-0000-000000000003"],"content":{}}'::jsonb,
    repeat('5',64), null, true,
    jsonb_build_array(jsonb_build_object(
      'assetId','00000000-0000-0000-0000-0000000000f3',
      'publicId','10000000-0000-0000-0000-000000000003',
      'position',0,'filename','not-on-board.jpg','width',1000,'height',1000,
      'previewR2Key','00000000-0000-0000-0000-00000000aaaa/previews/f3/medium.webp','downloadR2Key',null,
      'downloadFilename','not-on-board.webp','downloadMimeType','image/webp',
      'downloadQuality','web_1024')))$$,
  'P0002', 'publication_assets_not_found', 'an active project asset outside the board is refused');

-- ── valid two-photo version: reserve → copy → activate ─────────────────
select lives_ok(
  $$insert into created_publication
    select * from public.create_publication_share(
      '00000000-0000-0000-0000-0000000000e1', 'draft-main', 'article', 'Main story',
      '{"schemaVersion":1,"kind":"article","name":"Main story","publicAssetIds":["10000000-0000-0000-0000-000000000001","10000000-0000-0000-0000-000000000002"],"content":{"title":"Public title","sections":[]}}'::jsonb,
      repeat('a',64), now() + interval '7 days', true,
      jsonb_build_array(
        jsonb_build_object(
          'assetId','00000000-0000-0000-0000-0000000000f1',
          'publicId','10000000-0000-0000-0000-000000000001',
          'position',0,'filename','original.jpg','width',1200,'height',800,
          'previewR2Key','00000000-0000-0000-0000-00000000aaaa/previews/f1/medium.webp',
          'downloadR2Key','00000000-0000-0000-0000-00000000aaaa/originals/f1/original.jpg',
          'downloadFilename','original.jpg','downloadMimeType','image/jpeg',
          'downloadQuality','original'),
        jsonb_build_object(
          'assetId','00000000-0000-0000-0000-0000000000f2',
          'publicId','10000000-0000-0000-0000-000000000002',
          'position',1,'filename','drive.jpg','width',800,'height',1200,
          'previewR2Key','00000000-0000-0000-0000-00000000aaaa/edits/f2/medium.webp','downloadR2Key',null,
          'downloadFilename','drive.webp','downloadMimeType','image/webp',
          'downloadQuality','web_1024')))$$,
  'an editor atomically reserves a valid publication and media map');

select is((select jsonb_array_length(copy_plan) from created_publication), 2,
  'copy plan contains one immutable preview copy per public asset');
select is((select copy_plan->1->>'sourceR2Key' from created_publication),
  '00000000-0000-0000-0000-00000000aaaa/edits/f2/medium.webp', 'copy plan freezes the edited medium visible at publish time');
select ok((select copy_plan->0->>'destinationR2Key'
             = '00000000-0000-0000-0000-00000000aaaa/shares/' || id::text ||
               '/previews/10000000-0000-0000-0000-000000000001.webp'
             from created_publication),
  'destination key is share-owned and contains no source asset id');

reset role;
select is((select status from public.publication_shares
            where id = (select id from created_publication)),
  'preparing', 'a reserved publication is not public before R2 copies finish');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is_empty(
  $$select id from public.resolve_publication_share(repeat('a',64))$$,
  'the server resolver hides preparing publications');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(public.activate_publication_share((select id from created_publication)), true,
  'the creating editor activates only after the application completed its copies');

-- ── server-only safe read + separately gated files ────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select kind from public.resolve_publication_share(repeat('a',64))),
  'article', 'a valid token resolves the ready Article');
select is((select rights->>'credit' from public.resolve_publication_share(repeat('a',64))),
  'Photo: A / ArchiveMind', 'rights are a frozen server-derived public snapshot');
select is((select jsonb_array_length(assets) from public.resolve_publication_share(repeat('a',64))),
  2, 'the safe projection returns both opaque public media records');
select ok(not ((select assets->0 from public.resolve_publication_share(repeat('a',64))) ? 'downloadR2Key'),
  'the snapshot resolver never leaks an original download key');
select ok(not ((select assets->0 from public.resolve_publication_share(repeat('a',64))) ? 'previewR2Key'),
  'the page projection carries no preview key either: images are fetched per request');
select ok((select preview_r2_key
              = '00000000-0000-0000-0000-00000000aaaa/shares/' ||
                (select id::text from created_publication) ||
                '/previews/10000000-0000-0000-0000-000000000001.webp'
             from public.resolve_publication_share_preview(
               repeat('a',64), '10000000-0000-0000-0000-000000000001')),
  'a rendered picture resolves to its share-owned copy on its own request');
select is_empty(
  $$select public_id from public.resolve_publication_share_preview(
      repeat('a',64), '10000000-0000-0000-0000-000000000099')$$,
  'an unknown public media id has no preview capability');
select is_empty(
  $$select id from public.resolve_publication_share('not-a-hash')$$,
  'malformed and unknown token hashes fail closed as no row');
select is((select download_r2_key from public.resolve_publication_share_asset(
            repeat('a',64), '10000000-0000-0000-0000-000000000001')),
  '00000000-0000-0000-0000-00000000aaaa/originals/f1/original.jpg', 'stored originals resolve only through the download capability');
select ok((select download_r2_key
              = '00000000-0000-0000-0000-00000000aaaa/shares/' ||
                (select id::text from created_publication) ||
                '/previews/10000000-0000-0000-0000-000000000002.webp'
             from public.resolve_publication_share_asset(
               repeat('a',64), '10000000-0000-0000-0000-000000000002')),
  'Drive web_1024 download is the immutable share-owned copy, not a fake original');
select is_empty(
  $$select public_id from public.resolve_publication_share_asset(
      repeat('a',64), '10000000-0000-0000-0000-000000000099')$$,
  'an unknown public media id has no download capability');

-- ── downloads off removes the files, not the pictures ──────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok(
  $$insert into no_download_publication
    select * from public.create_publication_share(
      '00000000-0000-0000-0000-0000000000e1', 'draft-no-download', 'article', 'Read only',
      '{"schemaVersion":1,"kind":"article","name":"Read only","publicAssetIds":["10000000-0000-0000-0000-000000000021"],"content":{}}'::jsonb,
      repeat('e',64), null, false,
      jsonb_build_array(jsonb_build_object(
        'assetId','00000000-0000-0000-0000-0000000000f1',
        'publicId','10000000-0000-0000-0000-000000000021',
        'position',0,'filename','original.jpg','width',1200,'height',800,
        'previewR2Key','00000000-0000-0000-0000-00000000aaaa/previews/f1/medium.webp',
        'downloadR2Key','00000000-0000-0000-0000-00000000aaaa/originals/f1/original.jpg',
        'downloadFilename','original.jpg','downloadMimeType','image/jpeg',
        'downloadQuality','original')))$$,
  'a download-disabled publication is reserved');
select is(public.activate_publication_share((select id from no_download_publication)), true,
  'the download-disabled publication activates');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select isnt_empty(
  $$select preview_r2_key from public.resolve_publication_share_preview(
      repeat('e',64), '10000000-0000-0000-0000-000000000021')$$,
  'a publication with downloads off still renders its own photographs');
select is_empty(
  $$select download_r2_key from public.resolve_publication_share_asset(
      repeat('e',64), '10000000-0000-0000-0000-000000000021')$$,
  'downloads off withholds the file capability only');

-- ── the author can manage a link whose URL they no longer hold ─────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is((select count(*)::int from public.list_publication_shares(
            '00000000-0000-0000-0000-0000000000e1')
            where source_draft_id = 'draft-main'),
  1, 'an editor sees the live version of their own draft without its token');
select is((select status from public.list_publication_shares(
            '00000000-0000-0000-0000-0000000000e1')
            where source_draft_id = 'draft-main'),
  'ready', 'the status row carries the lifecycle the client derives from');
-- Scoping by board rather than by draft id is the point: a draft that vanished
-- with its localStorage must not take its live link out of reach.
select ok((select count(*)::int from public.list_publication_shares(
            '00000000-0000-0000-0000-0000000000e1')) >= 2,
  'the board-wide list also carries versions of other drafts');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select throws_ok(
  $$select * from public.list_publication_shares(
      '00000000-0000-0000-0000-0000000000e1')$$,
  '42501', 'publication_editor_required', 'a viewer cannot enumerate live links');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok(
  $$select * from public.list_publication_shares(
      '00000000-0000-0000-0000-0000000000e1')$$,
  '42501', 'publication_editor_required', 'a foreign owner cannot enumerate another tenant''s links');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select * from public.resolve_publication_share(repeat('a',64))$$,
  '42501', null, 'a bearer holder cannot invoke the server-only resolver directly');

-- The digest is unique even after revocation, so no future share can revive an
-- old URL by reusing its token.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok(
  $$select * from public.create_publication_share(
    '00000000-0000-0000-0000-0000000000e1', 'duplicate-token', 'article', 'Duplicate',
    '{"schemaVersion":1,"kind":"article","name":"Duplicate","publicAssetIds":[],"content":{}}'::jsonb,
    repeat('a',64), null, true, '[]'::jsonb)$$,
  '23505', null, 'token digests are globally unique');

-- Owner A did not create the link, but workspace owners are its safety valve.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into revoked_publication
    select * from public.revoke_publication_share((select id from created_publication))$$,
  'a workspace owner can revoke an editor-created publication');
select is((select jsonb_array_length(preview_r2_keys) from revoked_publication), 2,
  'revocation returns every share-owned preview key for idempotent R2 cleanup');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is_empty(
  $$select id from public.resolve_publication_share(repeat('a',64))$$,
  'revocation immediately removes both read and download authority');
select is_empty(
  $$select preview_r2_key from public.resolve_publication_share_preview(
      repeat('a',64), '10000000-0000-0000-0000-000000000001')$$,
  'a revoked publication stops answering the very next image request');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is_empty(
  $$select id from public.list_publication_shares(
      '00000000-0000-0000-0000-0000000000e1')
      where source_draft_id = 'draft-main'$$,
  'a revoked version leaves the author''s manageable-link list');

-- ── a text-only version outlives its source board ──────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok(
  $$insert into text_publication
    select * from public.create_publication_share(
      '00000000-0000-0000-0000-0000000000e9', 'draft-text', 'instagram_carousel', 'Text post',
      '{"schemaVersion":1,"kind":"instagram_carousel","name":"Text post","publicAssetIds":[],"content":{"caption":"Hello","slides":[]}}'::jsonb,
      repeat('b',64), null, false, '[]'::jsonb)$$,
  'zero-media text-only publication is valid');
select is((select copy_plan from text_publication), '[]'::jsonb,
  'a text-only publication has an empty copy plan');
select is(public.activate_publication_share((select id from text_publication)), true,
  'text-only publication activates without an R2 copy');

reset role;
delete from public.boards where id = '00000000-0000-0000-0000-0000000000e9';
select is((select board_id from public.publication_shares
            where id = (select id from text_publication)),
  null::uuid, 'hard-deleting a board nulls provenance instead of deleting the publication');
select is((select count(*)::int from public.publication_shares
            where id = (select id from text_publication)),
  1, 'the immutable publication row survives its source board');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select name from public.resolve_publication_share(repeat('b',64))),
  'Text post', 'the published version remains readable after source-board deletion');

-- ── asset privacy invalidation and expiry ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok(
  $$insert into asset_publication
    select * from public.create_publication_share(
      '00000000-0000-0000-0000-0000000000e1', 'draft-delete', 'article', 'Delete test',
      '{"schemaVersion":1,"kind":"article","name":"Delete test","publicAssetIds":["10000000-0000-0000-0000-000000000011"],"content":{}}'::jsonb,
      repeat('c',64), null, true,
      jsonb_build_array(jsonb_build_object(
        'assetId','00000000-0000-0000-0000-0000000000f1',
        'publicId','10000000-0000-0000-0000-000000000011',
        'position',0,'filename','original.jpg','width',1200,'height',800,
        'previewR2Key','00000000-0000-0000-0000-00000000aaaa/previews/f1/medium.webp',
        'downloadR2Key','00000000-0000-0000-0000-00000000aaaa/originals/f1/original.jpg',
        'downloadFilename','original.jpg','downloadMimeType','image/jpeg',
        'downloadQuality','original')))$$,
  'a second asset publication is reserved for invalidation testing');
select is(public.activate_publication_share((select id from asset_publication)), true,
  'the asset publication activates');

reset role;
update public.assets set status = 'deleted'
 where id = '00000000-0000-0000-0000-0000000000f1';
select is((select status from public.publication_shares
            where id = (select id from asset_publication)),
  'revoked', 'moving any published asset to Trash revokes the whole bearer link');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is_empty(
  $$select id from public.resolve_publication_share(repeat('c',64))$$,
  'an asset-trash-revoked publication cannot be read by the public server');

-- Expired and revoked are deliberately indistinguishable to a public caller.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok(
  $$insert into expiring_publication
    select * from public.create_publication_share(
      '00000000-0000-0000-0000-0000000000e1', 'draft-expiry', 'article', 'Expiring',
      '{"schemaVersion":1,"kind":"article","name":"Expiring","publicAssetIds":[],"content":{}}'::jsonb,
      repeat('d',64), now() + interval '7 days', true, '[]'::jsonb)$$,
  'an expiring text publication is reserved');
select is(public.activate_publication_share((select id from expiring_publication)), true,
  'the expiring publication activates while its deadline is in the future');

reset role;
update public.publication_shares
   set created_at = now() - interval '8 days',
       expires_at = now() - interval '1 day'
 where id = (select id from expiring_publication);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is_empty(
  $$select id from public.resolve_publication_share(repeat('d',64))$$,
  'an expired publication resolves exactly like an invalid or revoked token');

select * from finish();
rollback;
