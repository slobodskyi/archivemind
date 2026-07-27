-- topic_clusters suite (pgTAP) — run: `supabase test db`
-- Covers (ADR 0028): the updated_at trigger, the ON DELETE SET NULL FK that
-- drops members back to the tag heuristic, workspace-scoped RLS on the table
-- and on the embedded label join the web read path uses, write denial for
-- members (worker-only writes), and the new 'cluster' job type being live and
-- editor-gated on ai_jobs.
-- Also covers (ADR 0038): the is_renamed column, the editor-gated rename, and
-- the column ACL that lets an editor write ONLY label/is_renamed — centroid is
-- the k-means stability anchor, so forging it would corrupt every future
-- clustering of the workspace, not just one row.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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
-- C is a VIEWER of WS-A: topic_clusters_update is is_editor, not is_member, so
-- C proves the role gate bites inside the same workspace (cf. 005_image_edits).
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000c3', 'viewer');

-- Clusters: CA1 (WS-A, backdated to prove the updated_at trigger fires — now()
-- is constant within a txn, so a backdated seed is the only way to observe a
-- bump), CA2 (WS-A, throwaway for the FK set-null test), CB1 (WS-B).
insert into public.topic_clusters (id, workspace_id, label, size, centroid, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-00000000aaaa', 'yoga', 3,
   ('[1' || repeat(',0', 767) || ']')::vector, '2000-01-01', '2000-01-01'),
  ('00000000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-00000000aaaa', 'temp', 1,
   ('[1' || repeat(',0', 767) || ']')::vector, now(), now()),
  ('00000000-0000-0000-0000-0000000cb001', '00000000-0000-0000-0000-00000000bbbb', 'protest', 2,
   ('[0,1' || repeat(',0', 766) || ']')::vector, now(), now());

-- Assets in WS-A: f1 → CA1 (happy path), f2 → CA2 (FK set-null target),
-- f3 → CB1 (cross-workspace pointer: the worker never writes this, but it is
-- the sharpest way to prove the label join nulls out under RLS).
insert into public.assets (id, workspace_id, kind, title, cluster_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-1',
   '00000000-0000-0000-0000-0000000ca001'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-2',
   '00000000-0000-0000-0000-0000000ca002'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-3',
   '00000000-0000-0000-0000-0000000cb001');

-- ── superuser: trigger + FK behavior (RLS bypassed here) ────────────────
update public.topic_clusters set size = 5 where id = '00000000-0000-0000-0000-0000000ca001';
select ok(
  (select updated_at from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca001') > '2020-01-01'::timestamptz,
  'set_updated_at trigger bumps updated_at on update');

delete from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca002';
-- The member survives AND its pointer is nulled: proves SET NULL, not CASCADE
-- (a CASCADE regression would silently delete the photo — a scalar `is(...,null)`
-- alone can't tell the two apart, since a zero-row subquery is also null).
select results_eq(
  $$select id, cluster_id from public.assets where id = '00000000-0000-0000-0000-0000000000f2'$$,
  $$values ('00000000-0000-0000-0000-0000000000f2'::uuid, null::uuid)$$,
  'ON DELETE SET NULL keeps the member and nulls its cluster_id (not cascade-deleted)');

-- ── user A ──────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select results_eq(
  'select id from public.topic_clusters order by id',
  array['00000000-0000-0000-0000-0000000ca001'::uuid],
  'A sees only own-workspace clusters (WS-B cluster hidden by RLS)');

select is(
  (select tc.label from public.assets a
     left join public.topic_clusters tc on tc.id = a.cluster_id
     where a.id = '00000000-0000-0000-0000-0000000000f3'),
  null::text,
  'cross-workspace cluster label nulls out under RLS — the web falls back to the tag heuristic');

select is(
  (select tc.label from public.assets a
     left join public.topic_clusters tc on tc.id = a.cluster_id
     where a.id = '00000000-0000-0000-0000-0000000000f1'),
  'yoga'::text,
  'same-workspace cluster label is visible via the join (the happy read path)');

select throws_ok(
  $$insert into public.topic_clusters (workspace_id, label, centroid)
    values ('00000000-0000-0000-0000-00000000aaaa', 'x', ('[1' || repeat(',0', 767) || ']')::vector)$$,
  '42501', null, 'no insert policy — members cannot write clusters (worker-only)');

select lives_ok(
  $$insert into public.ai_jobs (workspace_id, user_id, type, payload)
    values ('00000000-0000-0000-0000-00000000aaaa',
            '00000000-0000-0000-0000-0000000000a1',
            'cluster', '{"workspace_id":"00000000-0000-0000-0000-00000000aaaa"}')$$,
  'cluster job type is live and editor-gated on ai_jobs (broadcast trigger fires)');

-- ── rename (ADR 0038) ───────────────────────────────────────────────────
select has_column('public', 'topic_clusters', 'is_renamed', 'topic_clusters.is_renamed exists');

select lives_ok(
  $$update public.topic_clusters set label = 'Morning practice', is_renamed = true
      where id = '00000000-0000-0000-0000-0000000ca001'$$,
  'an editor renames a cloud in their own workspace (topic_clusters_update)');
select is(
  (select label from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca001'),
  'Morning practice', 'the rename landed');
select is(
  (select is_renamed from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca001'),
  true, 'is_renamed is set, so the next re-cluster must preserve the label');

-- Column ACLs RAISE where RLS would silently filter — that asymmetry is the
-- whole point of narrowing the grant instead of relying on the route.
select throws_ok(
  $$update public.topic_clusters set centroid = ('[0,1' || repeat(',0', 766) || ']')::vector
      where id = '00000000-0000-0000-0000-0000000ca001'$$,
  '42501', null, 'an editor cannot write centroid — the k-means stability anchor is worker-owned');
select throws_ok(
  $$update public.topic_clusters set size = 999 where id = '00000000-0000-0000-0000-0000000ca001'$$,
  '42501', null, 'an editor cannot write size');
select throws_ok(
  $$update public.topic_clusters set workspace_id = '00000000-0000-0000-0000-00000000bbbb'
      where id = '00000000-0000-0000-0000-0000000ca001'$$,
  '42501', null, 'an editor cannot move a cluster to another workspace');

-- ── user C: a VIEWER of the same workspace ──────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is(
  (select label from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca001'),
  'Morning practice', 'a viewer still READS the cloud label (topic_clusters_select is is_member)');
-- RLS denial is a zero-row no-op, not an error (cf. 008_workspace_credit).
select lives_ok(
  $$update public.topic_clusters set label = 'viewer wuz here', is_renamed = true
      where id = '00000000-0000-0000-0000-0000000ca001'$$,
  'a viewer rename raises nothing — RLS filters the row rather than erroring');
select is(
  (select label from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca001'),
  'Morning practice', 'and it changed nothing: topic_clusters_update is is_editor, not is_member');

-- ── user B ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select results_eq(
  'select id from public.topic_clusters order by id',
  array['00000000-0000-0000-0000-0000000cb001'::uuid],
  'B sees only own-workspace clusters');

select is((select count(*)::int from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca001'), 0,
  'WS-A cluster invisible to B even when named explicitly');

select lives_ok(
  $$update public.topic_clusters set label = 'hijacked', is_renamed = true
      where id = '00000000-0000-0000-0000-0000000ca001'$$,
  'B renaming a WS-A cloud raises nothing (RLS filters, it does not throw)');

-- Read the result back as A, not as B: under B's claims the row is invisible,
-- so a count there would be 0 whether or not the hijack landed.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select label from public.topic_clusters where id = '00000000-0000-0000-0000-0000000ca001'),
  'Morning practice',
  'neither the viewer nor the outsider changed it — the owner still sees their own name');

select * from finish();
rollback;
