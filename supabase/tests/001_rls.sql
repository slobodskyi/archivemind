-- RLS regression suite (pgTAP) — run: `supabase test db`
-- Gate for migration PRs (ADR 0013 / issue #31). Mirrors and extends the
-- Phase-0 smoke checks: workspace isolation, asset-child isolation, write
-- denial, bootstrap path, token-column revoke, broadcast trigger.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── fixtures (as superuser) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.dev'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@test.dev');
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
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-photo');
insert into public.captions (asset_id, lang, style, text) values
  ('00000000-0000-0000-0000-0000000000f2', 'en', 'social', 'B caption');
insert into public.source_connections (workspace_id, user_id, provider, access_token_enc) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'gdrive', 'ENC');

-- ── user A ──────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.assets), 1, 'A sees exactly own assets');
select is((select count(*)::int from public.captions), 0, 'A cannot see WS-B captions (asset-child RLS)');
select results_eq(
  'select id from public.workspaces',
  array['00000000-0000-0000-0000-00000000aaaa'::uuid],
  'A sees own workspace only');
select is((select count(*)::int from public.profiles where id <> '00000000-0000-0000-0000-0000000000a1'), 0,
  'A sees no stranger profiles');
select throws_ok(
  $$insert into public.assets (workspace_id, kind, title)
    values ('00000000-0000-0000-0000-00000000bbbb', 'photo', 'intruder')$$,
  '42501', null, 'cross-workspace asset insert blocked by RLS');
select lives_ok(
  $$insert into public.ai_jobs (workspace_id, user_id, type, payload)
    values ('00000000-0000-0000-0000-00000000aaaa',
            '00000000-0000-0000-0000-0000000000a1',
            'analyze', '{"asset_ids":[]}')$$,
  'editor can enqueue a job (broadcast trigger fires without error)');
select is((select count(*)::int from public.ai_jobs), 1, 'A sees the enqueued job');
select throws_ok(
  $$select access_token_enc from public.source_connections limit 1$$,
  '42501', null, 'token columns unreadable for authenticated');
select is((select count(*)::int from public.source_connections), 1,
  'connection metadata (non-token columns) still visible to members');

-- ── user C: first-login bootstrap path (migration 0002) ─────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select lives_ok(
  $$insert into public.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000c3', 'C');
    insert into public.workspaces (id, name, created_by)
      values ('00000000-0000-0000-0000-00000000cccc', 'WS-C', '00000000-0000-0000-0000-0000000000c3');
    insert into public.memberships (workspace_id, user_id, role)
      values ('00000000-0000-0000-0000-00000000cccc', '00000000-0000-0000-0000-0000000000c3', 'owner')$$,
  'bootstrap: profile → workspace → self-owner membership under own RLS');
select is((select count(*)::int from public.workspaces where id = '00000000-0000-0000-0000-00000000cccc'), 1,
  'creator sees own workspace (RETURNING-safe)');
select is((select count(*)::int from public.workspaces), 1, 'C cannot see other workspaces');

-- ── projects M:N isolation (issue #17) ──────────────────────────────────
-- User A owns asset f1 in WS-A; create a project and link the asset (allowed),
-- then user B must not be able to link A's asset into A's project.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into public.projects (id, workspace_id, name, created_by)
      values ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000aaaa', 'A-proj', '00000000-0000-0000-0000-0000000000a1');
    insert into public.project_assets (project_id, asset_id)
      values ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000f1')$$,
  'owner links own asset into own project');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok(
  $$insert into public.project_assets (project_id, asset_id)
    values ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'non-member cannot link into another workspace''s project');

select * from finish();
rollback;
