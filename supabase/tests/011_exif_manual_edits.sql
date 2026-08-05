-- Manual Metadata/EXIF corrections suite (pgTAP) — run: `supabase test db`
--
-- Covers migration 20260805000001: the two new columns, the insert/update
-- policies that made asset_exif writable from a browser at all (it had only ever
-- had a SELECT policy), the column ACL that keeps `raw`/`focal_length`/`asset_id`
-- out of an editor's reach, and the role gates on both sides.
--
-- The last three tests are the important ones, and they exist for the reason
-- 009_export_queries.sql exists: they EXECUTE the upsert that
-- apps/worker/src/handlers/ingest.ts embeds. That statement runs on far more
-- than a first ingest — a dedup revival, a retry and the #113 HEIC re-extract
-- all reach it — so if its per-column guard regresses, a re-ingest silently
-- overwrites a correction with the value the user was correcting, and no
-- TypeScript test would notice. The CI path filter already includes
-- apps/worker/src/handlers/**, so editing that file re-runs this suite.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
-- C is a VIEWER of WS-A: the new policies are is_editor_of_asset, not
-- is_member_of_asset, so C proves the role gate bites inside the workspace.
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000c3', 'viewer');

-- f1 has EXIF (the correction target); f2 has NO asset_exif row at all, which
-- is what a file whose extraction found nothing looks like — the route inserts
-- there, so the insert policy has to cover it.
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-2');

insert into public.asset_exif (asset_id, taken_at, camera_make, camera_model, lens, iso, raw) values
  ('00000000-0000-0000-0000-0000000000f1', '2026-06-18 23:41+00', 'Nikon', 'Z6 II', '24-70mm', 6400,
   '{"Make":"Nikon"}'::jsonb);

select has_column('public', 'asset_exif', 'edited_fields', 'asset_exif.edited_fields exists');
select has_column('public', 'asset_exif', 'original_values', 'asset_exif.original_values exists');

-- ── user A: an editor of WS-A ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$update public.asset_exif
       set camera_model = 'Leica M11', camera_make = null,
           edited_fields = array['camera_model','camera_make'],
           original_values = '{"camera_model":"Z6 II","camera_make":"Nikon"}'::jsonb
     where asset_id = '00000000-0000-0000-0000-0000000000f1'$$,
  'an editor corrects the camera on their own asset (asset_exif_update)');
select is(
  (select camera_model from public.asset_exif where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  'Leica M11', 'the correction landed');

-- The row a file with no extractable EXIF needs before it can be corrected.
select lives_ok(
  $$insert into public.asset_exif (asset_id, camera_model, edited_fields, original_values)
    values ('00000000-0000-0000-0000-0000000000f2', 'Hasselblad 500C',
            array['camera_model'], '{"camera_model":null}'::jsonb)$$,
  'an editor inserts EXIF for an asset whose file carried none (asset_exif_insert)');

-- Column ACLs RAISE where RLS would silently filter — the reason the grant is
-- narrowed instead of trusting the route to send the right columns.
select throws_ok(
  $$update public.asset_exif set raw = '{}'::jsonb
      where asset_id = '00000000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'an editor cannot rewrite raw — the only record of what the file itself claimed');
select throws_ok(
  $$update public.asset_exif set focal_length = '35mm'
      where asset_id = '00000000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'an editor cannot write focal_length — no UI produces it');
select throws_ok(
  $$update public.asset_exif set asset_id = '00000000-0000-0000-0000-0000000000f2'
      where asset_id = '00000000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'an editor cannot move a correction onto another asset');

-- ── user C: a VIEWER of the same workspace ──────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is(
  (select camera_model from public.asset_exif where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  'Leica M11', 'a viewer still READS the metadata (asset_exif_select is is_member)');
-- RLS denial is a zero-row no-op, not an error, so the proof is that the value
-- did not move.
update public.asset_exif set lens = 'viewer wuz here'
  where asset_id = '00000000-0000-0000-0000-0000000000f1';
select is(
  (select lens from public.asset_exif where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  '24-70mm', 'a viewer cannot correct metadata — is_editor_of_asset, not is_member');

-- ── user B: another workspace entirely ──────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is_empty(
  $$select asset_id from public.asset_exif$$,
  'B sees no EXIF from WS-A at all');
update public.asset_exif set lens = 'outsider'
  where asset_id = '00000000-0000-0000-0000-0000000000f1';
select is(
  (select lens from public.asset_exif where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  null::text,
  'B''s update matched no visible row (and B cannot read the result either)');

-- ── the ingest upsert (apps/worker/src/handlers/ingest.ts) ──────────────
-- The worker connects as the table owner and is subject to neither RLS nor the
-- column grant, so drop back to superuser — running this as `authenticated`
-- would test the wrong thing entirely.
reset role;
select is(
  (select lens from public.asset_exif where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  '24-70mm', 'neither the viewer nor the outsider changed anything');

-- Mark lens as hand-corrected alongside the camera, then re-run ingest's upsert
-- with completely different values, exactly as a dedup revival would.
update public.asset_exif
   set lens = '50mm Summilux',
       edited_fields = array['camera_model','camera_make','lens']
 where asset_id = '00000000-0000-0000-0000-0000000000f1';

insert into asset_exif (asset_id, taken_at, camera_make, camera_model, lens,
                        gps_lat, gps_lon, gps_label, location_source, iso, aperture,
                        shutter, focal_length, raw)
values ('00000000-0000-0000-0000-0000000000f1', '1999-01-01 00:00+00', 'Canon', 'EOS R5', 'RF 24-105',
        1.5, 2.5, 'Somewhere', 'gps', 100, 'f/4', '1/60s', '105mm', '{"Make":"Canon"}'::jsonb)
on conflict (asset_id) do update set
  taken_at=case when 'taken_at'=any(asset_exif.edited_fields)
                then asset_exif.taken_at else excluded.taken_at end,
  camera_make=case when 'camera_make'=any(asset_exif.edited_fields)
                   then asset_exif.camera_make else excluded.camera_make end,
  camera_model=case when 'camera_model'=any(asset_exif.edited_fields)
                    then asset_exif.camera_model else excluded.camera_model end,
  lens=case when 'lens'=any(asset_exif.edited_fields)
            then asset_exif.lens else excluded.lens end,
  gps_lat=case when 'gps_lat'=any(asset_exif.edited_fields)
               then asset_exif.gps_lat else excluded.gps_lat end,
  gps_lon=case when 'gps_lon'=any(asset_exif.edited_fields)
               then asset_exif.gps_lon else excluded.gps_lon end,
  gps_label=case when 'gps_label'=any(asset_exif.edited_fields)
                 then asset_exif.gps_label else excluded.gps_label end,
  location_source=case when 'location_source'=any(asset_exif.edited_fields)
                       then asset_exif.location_source else excluded.location_source end,
  iso=case when 'iso'=any(asset_exif.edited_fields)
           then asset_exif.iso else excluded.iso end,
  aperture=case when 'aperture'=any(asset_exif.edited_fields)
                then asset_exif.aperture else excluded.aperture end,
  shutter=case when 'shutter'=any(asset_exif.edited_fields)
               then asset_exif.shutter else excluded.shutter end,
  focal_length=excluded.focal_length, raw=excluded.raw;

select results_eq(
  $$select camera_model, lens from public.asset_exif
     where asset_id = '00000000-0000-0000-0000-0000000000f1'$$,
  $$values ('Leica M11'::text, '50mm Summilux'::text)$$,
  're-ingest preserves every hand-corrected column');
select is(
  (select iso from public.asset_exif where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  100, 're-ingest still refreshes columns nobody corrected');
select is(
  (select raw->>'Make' from public.asset_exif where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  'Canon', 're-ingest always refreshes raw — it is the file''s own dump, never the user''s');

select * from finish();
rollback;
