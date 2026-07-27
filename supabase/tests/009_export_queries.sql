-- Export worker queries actually EXECUTE against the real schema (pgTAP).
--
-- Why this file exists: `apps/worker/src/handlers/export-zip.ts` selected
-- `asset_previews.byte_size`, a column that has never existed (that table holds
-- asset_id/size/r2_key/width/height). Every ZIP export failed in production with
-- `column ap.byte_size does not exist`, retried three times and died. Nothing
-- caught it: the planner is a pure function tested over hand-written row objects,
-- the zip writer is tested over buffers, and no test had ever run the SQL.
--
-- So: run the queries. They are copied from the TypeScript — the header above
-- each one names its source — and the CI path filter includes
-- apps/worker/src/handlers/** precisely so that editing one of those files
-- re-runs this suite and any drift shows up in the same PR.
--
-- These assert only that the SQL is VALID against the schema (tables, columns,
-- joins, casts). Behaviour is covered by the unit tests around them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Fixture ids used as literal parameters below.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev');
insert into public.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000a1', 'A');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1');
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'DSC_0001.NEF');

-- ── handlers/export.ts :: collectExportRows (selection branch) ───────────
select lives_ok($$
  select a.id as asset_id, a.title,
         coalesce(ae.edited_medium_key, ap.r2_key) as medium_key
    from assets a
    left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
    left join asset_edits ae on ae.asset_id = a.id
   where a.id = any(array['00000000-0000-0000-0000-0000000000f1']::uuid[])
     and a.status = 'active'
$$, 'collectExportRows: selection branch');

-- ── handlers/export.ts :: collectExportRows (group branch) ───────────────
select lives_ok($$
  select cga.asset_id, a.title,
         coalesce(ae.edited_medium_key, ap.r2_key) as medium_key
    from canvas_group_assets cga
    join assets a on a.id = cga.asset_id and a.status = 'active'
    left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
    left join asset_edits ae on ae.asset_id = a.id
   where cga.group_id = '00000000-0000-0000-0000-0000000000c1'
   order by cga.position asc, cga.added_at asc
   limit 500
$$, 'collectExportRows: group branch');

-- ── handlers/export.ts :: EXIF summary line + cover date range ───────────
select lives_ok($$
  select asset_id, camera_make, camera_model, taken_at, gps_label
    from asset_exif where asset_id = any(array['00000000-0000-0000-0000-0000000000f1']::uuid[])
$$, 'export: exif summary');
select lives_ok($$
  select min(taken_at)::text as from, max(taken_at)::text as to
    from asset_exif where asset_id = any(array['00000000-0000-0000-0000-0000000000f1']::uuid[])
$$, 'export: cover date range');

-- ── handlers/export.ts :: workspace credit block (migration 20260727000001) ──
select lives_ok($$
  select creator, credit, copyright_notice, usage_terms
    from workspaces where id = '00000000-0000-0000-0000-00000000aaaa'
$$, 'export: workspace credit block');

-- ── handlers/export-zip.ts :: renderZip byte query ───────────────────────
-- THE REGRESSION. asset_previews has no byte_size; only files does.
select lives_ok($$
  select a.id as asset_id, a.title,
         f.r2_key as original_key, f.byte_size,
         coalesce(ae.edited_medium_key, ap.r2_key) as medium_key
    from assets a
    left join lateral (
      select r2_key, byte_size from files
       where asset_id = a.id
       order by (r2_key is null), created_at
       limit 1
    ) f on true
    left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
    left join asset_edits ae on ae.asset_id = a.id
   where a.id = any(array['00000000-0000-0000-0000-0000000000f1']::uuid[])
$$, 'renderZip: byte query (regression — ap.byte_size never existed)');

-- ── handlers/export-csv.ts :: tags, facts-with-status, AI description ────
select lives_ok($$
  select at.asset_id, t.name
    from asset_tags at join tags t on t.id = at.tag_id
   where at.asset_id = any(array['00000000-0000-0000-0000-0000000000f1']::uuid[])
   order by at.asset_id, t.name
$$, 'renderCaptionsCsv: tags');
select lives_ok($$
  select asset_id, camera_make, camera_model, lens, iso, aperture, shutter,
         taken_at, gps_lat, gps_lon, gps_label
    from asset_exif where asset_id = any(array['00000000-0000-0000-0000-0000000000f1']::uuid[])
$$, 'renderCaptionsCsv: full exif');

-- ── purge.ts :: purgeExportArtifacts + retention.ts :: sweepExpiredExports ──
select lives_ok($$
  select id, payload->>'result_key' as result_key
    from ai_jobs
   where type = 'export'
     and payload ? 'result_key'
     and workspace_id = (select workspace_id from assets where id = '00000000-0000-0000-0000-0000000000f1')
     and (payload->'exported_asset_ids' @> to_jsonb('00000000-0000-0000-0000-0000000000f1'::text)
          or payload->'asset_ids' @> to_jsonb('00000000-0000-0000-0000-0000000000f1'::text))
$$, 'purgeExportArtifacts + sweepExpiredExports shape');

select * from finish();
rollback;
