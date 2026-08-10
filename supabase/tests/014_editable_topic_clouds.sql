-- Editable Topic clouds suite (pgTAP) — run: `supabase test db`
--
-- Covers migration 20260810000001 / ADR 0042: generated-vs-manual storage,
-- the one-row effective override, atomic SECURITY DEFINER mutations, editor
-- and tenant gates, preservation of assets.cluster_id as the AI baseline, and
-- manual-topic deletion falling back to that baseline.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

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
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000c3', 'viewer');

-- Origin omitted deliberately: every pre-migration row must backfill/default
-- to generated, with its real centroid intact.
insert into public.topic_clusters (id, workspace_id, label, size, centroid, is_renamed) values
  ('00000000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-00000000aaaa', 'AI family', 1,
   ('[1' || repeat(',0', 767) || ']')::vector, false),
  ('00000000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-00000000aaaa', 'AI travel', 1,
   ('[0,1' || repeat(',0', 766) || ']')::vector, false),
  ('00000000-0000-0000-0000-0000000cb001', '00000000-0000-0000-0000-00000000bbbb', 'B topic', 1,
   ('[0,0,1' || repeat(',0', 765) || ']')::vector, false);

insert into public.assets (id, workspace_id, kind, title, cluster_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-1',
   '00000000-0000-0000-0000-0000000ca001'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-2',
   '00000000-0000-0000-0000-0000000ca002'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-3', null),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-1',
   '00000000-0000-0000-0000-0000000cb001');

-- ── schema invariants ──────────────────────────────────────────────────
select has_table('public', 'topic_cluster_overrides', 'topic_cluster_overrides exists');
select has_column('public', 'topic_clusters', 'origin', 'topic_clusters.origin exists');
select is(
  enum_range(null::topic_cluster_origin)::text,
  '{generated,manual}',
  'topic_cluster_origin has exactly generated and manual');
select is(
  (select origin from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca001'),
  'generated'::topic_cluster_origin,
  'existing/default rows are generated');

select lives_ok(
  $$insert into public.topic_clusters
      (id, workspace_id, label, size, centroid, origin, is_renamed)
    values ('00000000-0000-0000-0000-0000000ca099',
            '00000000-0000-0000-0000-00000000aaaa',
            'Empty manual topic', 0, null, 'manual', true)$$,
  'a manual topic has no fabricated centroid');
select throws_ok(
  $$insert into public.topic_clusters (workspace_id, label, centroid, origin)
    values ('00000000-0000-0000-0000-00000000aaaa', 'bad generated', null, 'generated')$$,
  '23514', null, 'a generated topic must carry a centroid');
select throws_ok(
  $$insert into public.topic_clusters (workspace_id, label, centroid, origin)
    values ('00000000-0000-0000-0000-00000000aaaa', 'bad manual',
            ('[1' || repeat(',0', 767) || ']')::vector, 'manual')$$,
  '23514', null, 'a manual topic cannot masquerade as a generated centroid');

select ok(
  not has_function_privilege('anon', 'public.create_manual_topic(uuid,text,uuid[])', 'EXECUTE'),
  'anon cannot call the RLS-crossing create RPC');
select ok(
  has_function_privilege('authenticated', 'public.create_manual_topic(uuid,text,uuid[])', 'EXECUTE'),
  'authenticated callers can reach the RPC, which performs its own editor check');

-- ── user A: editor/owner of WS-A ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$insert into public.topic_cluster_overrides (asset_id, workspace_id, cluster_id, assigned_by)
    values ('00000000-0000-0000-0000-0000000000f3',
            '00000000-0000-0000-0000-00000000aaaa',
            '00000000-0000-0000-0000-0000000ca001',
            '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'clients cannot bypass the atomic RPC with a direct override insert');

select lives_ok(
  $$select * from public.create_manual_topic(
      '00000000-0000-0000-0000-00000000aaaa',
      '  Family picks  ',
      array['00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-0000000000f2']::uuid[])$$,
  'an editor creates a manual topic and seeds a batch atomically');
select is(
  (select count(*)::int from public.topic_clusters
    where workspace_id = '00000000-0000-0000-0000-00000000aaaa'
      and label = 'Family picks' and origin = 'manual' and centroid is null and is_renamed),
  1, 'the created topic is trimmed, manual, centroid-less and pinned');
select is(
  (select size from public.topic_clusters where label = 'Family picks'),
  2, 'manual topic size is its live override count');
select is(
  (select count(*)::int from public.topic_cluster_overrides o
    join public.topic_clusters tc on tc.id = o.cluster_id
    where tc.label = 'Family picks'),
  2, 'both selected photos got one effective override');
select is(
  (select tc.label from public.topic_cluster_overrides o
    join public.topic_clusters tc on tc.id = o.cluster_id
    where o.asset_id = '00000000-0000-0000-0000-0000000000f1'),
  'Family picks', 'the override is the effective Topic target');
select is(
  (select cluster_id from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  '00000000-0000-0000-0000-0000000ca001'::uuid,
  'creating a manual topic leaves the AI baseline untouched');

select lives_ok(
  $$select public.assign_topic_assets(
      '00000000-0000-0000-0000-00000000aaaa',
      array['00000000-0000-0000-0000-0000000000f1']::uuid[],
      '00000000-0000-0000-0000-0000000ca002')$$,
  'an editor moves a photo into an existing generated topic');
select is(
  (select cluster_id from public.topic_cluster_overrides
    where asset_id = '00000000-0000-0000-0000-0000000000f1'),
  '00000000-0000-0000-0000-0000000ca002'::uuid,
  'the effective override now points at that generated topic');
select is(
  (select size from public.topic_clusters where label = 'Family picks'),
  1, 'moving out decrements a manual topic size exactly once');

-- The worker also carries a NOT EXISTS guard, but the FK is the last line of
-- defence: even a privileged, buggy direct delete must fail rather than erase
-- the manual assignment. This has to run as superuser so RLS/no-delete-policy
-- is not what blocks it.
reset role;
select throws_ok(
  $$delete from public.topic_clusters
     where id = '00000000-0000-0000-0000-0000000ca002'$$,
  '23503', null,
  'ON DELETE RESTRICT prevents a generated-topic delete from erasing an override');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$select public.assign_topic_assets(
      '00000000-0000-0000-0000-00000000aaaa',
      array['00000000-0000-0000-0000-0000000000f1']::uuid[], null)$$,
  'cluster null is Return to AI');
select is_empty(
  $$select 1 from public.topic_cluster_overrides
    where asset_id = '00000000-0000-0000-0000-0000000000f1'$$,
  'Return to AI deletes the override');
select is(
  (select cluster_id from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  '00000000-0000-0000-0000-0000000ca001'::uuid,
  'Return to AI reveals the unchanged baseline');

select throws_ok(
  $$select public.assign_topic_assets(
      '00000000-0000-0000-0000-00000000aaaa',
      array['00000000-0000-0000-0000-0000000000f3'::uuid, null],
      '00000000-0000-0000-0000-0000000ca001')$$,
  '22023', 'invalid_topic_assets',
  'the exposed RPC rejects a null array member cleanly instead of reaching a NOT NULL error');

select throws_ok(
  $$select * from public.create_manual_topic(
      '00000000-0000-0000-0000-00000000aaaa', 'Must roll back',
      array['00000000-0000-0000-0000-0000000000f3',
            '00000000-0000-0000-0000-0000000000e1']::uuid[])$$,
  'P0002', 'topic_assets_not_found',
  'a mixed-workspace selection is refused as one unit');
select is_empty(
  $$select id from public.topic_clusters where label = 'Must roll back'$$,
  'the failed create left no empty topic behind (atomic create + assign)');
select throws_ok(
  $$select public.assign_topic_assets(
      '00000000-0000-0000-0000-00000000aaaa',
      array['00000000-0000-0000-0000-0000000000f3']::uuid[],
      '00000000-0000-0000-0000-0000000cb001')$$,
  'P0002', 'topic_not_found',
  'an editor cannot target another workspace''s topic');
select is(
  public.delete_manual_topic(
    '00000000-0000-0000-0000-00000000aaaa',
    '00000000-0000-0000-0000-0000000ca001'),
  false,
  'the delete RPC never deletes a generated worker-owned topic');

-- ── user C: VIEWER of WS-A ─────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is(
  (select count(*)::int from public.topic_cluster_overrides),
  1, 'a viewer reads effective assignments in their workspace');
select throws_ok(
  $$select * from public.create_manual_topic(
      '00000000-0000-0000-0000-00000000aaaa', 'Viewer topic',
      array['00000000-0000-0000-0000-0000000000f3']::uuid[])$$,
  '42501', 'topic_editor_required', 'a viewer cannot create a topic');
select throws_ok(
  $$select public.assign_topic_assets(
      '00000000-0000-0000-0000-00000000aaaa',
      array['00000000-0000-0000-0000-0000000000f3']::uuid[], null)$$,
  '42501', 'topic_editor_required', 'a viewer cannot reset assignments');

-- ── user B: another workspace ──────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is_empty(
  $$select asset_id from public.topic_cluster_overrides$$,
  'another workspace sees none of WS-A''s overrides');

-- ── delete a manual topic: explicit override delete → AI fallback ──────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  public.delete_manual_topic(
    '00000000-0000-0000-0000-00000000aaaa',
    (select id from public.topic_clusters where label = 'Family picks')),
  true,
  'an editor deletes their manual topic');
select is_empty(
  $$select id from public.topic_clusters where label = 'Family picks'$$,
  'the manual topic row is gone');
select is_empty(
  $$select asset_id from public.topic_cluster_overrides
    where asset_id = '00000000-0000-0000-0000-0000000000f2'$$,
  'its remaining overrides are removed atomically before the RESTRICTed row');
select is(
  (select cluster_id from public.assets where id = '00000000-0000-0000-0000-0000000000f2'),
  '00000000-0000-0000-0000-0000000ca002'::uuid,
  'the deleted manual topic member falls back to its untouched AI baseline');

select * from finish();
rollback;
