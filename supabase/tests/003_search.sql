-- search_assets() suite (pgTAP) — run: `supabase test db`
-- Covers: function presence, RLS-invoker workspace isolation, date filter,
-- tag matching surfaced for the UI's "why it matched" explanation (incl. the
-- word-of-multi-word rule and tag-first ordering from 20260722000002), and
-- the members' usage_events INSERT policy.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ── fixtures (as superuser) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'A'),
  ('00000000-0000-0000-0000-0000000000b2', 'B');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000bbbb', 'WS-B', '00000000-0000-0000-0000-0000000000b2');
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner');
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-old'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-new'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-photo');
insert into public.asset_exif (asset_id, taken_at, gps_label) values
  ('00000000-0000-0000-0000-0000000000f1', '2026-01-10', 'Kyiv, Ukraine'),
  ('00000000-0000-0000-0000-0000000000f2', '2026-06-18', null);
insert into public.tags (id, workspace_id, name, category) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000aaaa', 'rescue', 'event'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000aaaa', 'flood rescue', 'event');
insert into public.asset_tags (asset_id, tag_id, source) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000e001', 'ai'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000e002', 'ai');
-- Unit vectors: f1 sits exactly on axis 1, f2 nearby (cos 0.8 to axis 1), f3
-- on axis 2 — so an axis-1 query ranks f1 > f2 by cosine alone and B's asset
-- at 0, letting the tag-first ordering test observe a genuine reorder.
insert into public.embeddings (workspace_id, asset_id, kind, chunk_index, embedding) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000f1', 'image', 0,
   ('[1' || repeat(',0', 767) || ']')::vector),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000f2', 'image', 0,
   ('[0.8,0.6' || repeat(',0', 766) || ']')::vector),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000f3', 'image', 0,
   ('[0,1' || repeat(',0', 766) || ']')::vector);

select has_function('public', 'search_assets', 'search_assets() exists');

-- ── user A ──────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from public.search_assets(
     ('[1' || repeat(',0', 767) || ']')::vector, '00000000-0000-0000-0000-00000000aaaa')),
  2, 'A finds both own assets');

select is(
  (select count(*)::int from public.search_assets(
     ('[0,1' || repeat(',0', 766) || ']')::vector, '00000000-0000-0000-0000-00000000bbbb')),
  0, 'A gets zero rows from WS-B even when naming it (RLS via invoker)');

select is(
  (select count(*)::int from public.search_assets(
     ('[1' || repeat(',0', 767) || ']')::vector, '00000000-0000-0000-0000-00000000aaaa',
     null, '2026-06-01'::timestamptz, null)),
  1, 'date_from filter keeps only the June asset');

select results_eq(
  $$select matched_tags from public.search_assets(
      ('[1' || repeat(',0', 767) || ']')::vector, '00000000-0000-0000-0000-00000000aaaa',
      null, null, null, null, array['rescue']) order by asset_id$$,
  $$values ('{}'::text[]), ('{flood rescue,rescue}'::text[])$$,
  'matched tag terms surface per asset — exact AND whole-word of multi-word tags');

select results_eq(
  $$select matched_tags from public.search_assets(
      ('[1' || repeat(',0', 767) || ']')::vector, '00000000-0000-0000-0000-00000000aaaa',
      null, null, null, null, array['flood']) order by asset_id$$,
  $$values ('{}'::text[]), ('{flood rescue}'::text[])$$,
  'a term matching one whole word of a multi-word tag counts; no substring matches');

select results_eq(
  $$select asset_id from public.search_assets(
      ('[1' || repeat(',0', 767) || ']')::vector, '00000000-0000-0000-0000-00000000aaaa',
      null, null, null, null, array['rescue'])$$,
  $$values ('00000000-0000-0000-0000-0000000000f2'::uuid), ('00000000-0000-0000-0000-0000000000f1'::uuid)$$,
  'tag-matched rows rank above cosine-only rows even at lower similarity');

select is(
  (select count(*)::int from public.search_assets(
     ('[1' || repeat(',0', 767) || ']')::vector, '00000000-0000-0000-0000-00000000aaaa',
     null, null, null, array['kyiv'], null)),
  1, 'place term matches gps_label case-insensitively');

select lives_ok(
  $$insert into public.usage_events (workspace_id, user_id, event_type, units, model)
    values ('00000000-0000-0000-0000-00000000aaaa',
            '00000000-0000-0000-0000-0000000000a1', 'search_query', 1, 'test-model')$$,
  'member can log a search_query usage event (new insert policy)');

select * from finish();
rollback;
