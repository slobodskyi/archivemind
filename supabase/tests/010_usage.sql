-- Usage & Storage (pgTAP) — run: `supabase test db`. Migration 20260727000002.
--
-- Two things can go wrong here and both are silent. The arithmetic can put
-- bytes in the wrong bucket (a deleted photo counted as live storage, a
-- Drive-linked original billed to a workspace that doesn't hold it, an
-- embedding counted as a second credit), and the RPC — SECURITY INVOKER, RLS as
-- its only boundary — can leak another workspace's numbers to whoever passes
-- its id. Neither shows up as an error; both show up as a wrong number on a
-- page people will eventually be billed from. So: exact expected values, and a
-- cross-workspace call that must come back empty.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- ── fixtures (as superuser) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.dev'),
  ('00000000-0000-0000-0000-0000000000c3', 'stranger@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'A'),
  ('00000000-0000-0000-0000-0000000000b2', 'B'),
  ('00000000-0000-0000-0000-0000000000c3', 'Stranger');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000bb', 'WS-B', '00000000-0000-0000-0000-0000000000b2');
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b2', 'owner');

-- WS-A: one uploaded photo, one Drive-linked photo, one trashed photo, one
-- purged tombstone. Between them they exercise every storage bucket.
insert into public.assets (id, workspace_id, kind, status, purged_at) values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'active', null),
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'active', null),
  ('00000000-0000-0000-0000-0000000a0003', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'deleted', null),
  ('00000000-0000-0000-0000-0000000a0004', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'deleted', now()),
  ('00000000-0000-0000-0000-0000000b0009', '00000000-0000-0000-0000-0000000000bb', 'photo', 'active', null);

insert into public.files (asset_id, workspace_id, origin, r2_key, byte_size) values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000aaaa', 'upload', 'ws-a/o/1', 1000),
  -- r2_key null = the bytes live in Drive (§6). They must NOT land in originals.
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-00000000aaaa', 'gdrive', null,      5000),
  ('00000000-0000-0000-0000-0000000a0003', '00000000-0000-0000-0000-00000000aaaa', 'upload', 'ws-a/o/3', 700),
  ('00000000-0000-0000-0000-0000000b0009', '00000000-0000-0000-0000-0000000000bb', 'upload', 'ws-b/o/9', 999999);

insert into public.asset_previews (asset_id, size, r2_key, byte_size) values
  ('00000000-0000-0000-0000-0000000a0001', 'thumb',  'ws-a/p/1t', 100),
  ('00000000-0000-0000-0000-0000000a0001', 'medium', 'ws-a/p/1m', 200),
  ('00000000-0000-0000-0000-0000000a0002', 'thumb',  'ws-a/p/2t', 50),
  ('00000000-0000-0000-0000-0000000a0002', 'medium', 'ws-a/p/2m', 150),
  ('00000000-0000-0000-0000-0000000a0003', 'thumb',  'ws-a/p/3t', 30);

insert into public.asset_edits (asset_id, recipe, edited_thumb_key, edited_medium_key, thumb_bytes, medium_bytes)
values ('00000000-0000-0000-0000-0000000a0001', '{}'::jsonb, 'ws-a/e/1t', 'ws-a/e/1m', 10, 20);

-- A finished export whose artifact is still in R2 (`result_key` present — the
-- sweeper strips that key when it deletes the object).
insert into public.ai_jobs (workspace_id, user_id, type, status, payload) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'export', 'done',
   '{"result_key":"ws-a/exports/x.pdf","result_bytes":4000}'::jsonb);

-- Credits: analyze + captions count, the other three must not.
insert into public.usage_events (workspace_id, user_id, event_type, units) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'image_analyzed',    3),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'embedding',         3),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'caption_generated', 5),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'search_query',      7),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'export',            2);

-- ── shape ────────────────────────────────────────────────────────────────
select has_column('public', 'asset_previews', 'byte_size', 'asset_previews records its own size');
select has_column('public', 'asset_edits', 'thumb_bytes', 'asset_edits records its rendered sizes');
select has_column('public', 'usage_events', 'bytes', 'usage_events can carry bytes (ingest)');

select is((select count(*)::int from public.plans), 3, 'three plans ship');
select is(
  (select plan from public.workspaces where id = '00000000-0000-0000-0000-00000000aaaa'),
  'beta',
  'existing workspaces land on the beta plan');

-- ── the numbers, as WS-A's owner ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'storage'->>'originals')::bigint,
  1000::bigint,
  'originals = R2-backed active files only (the Drive-linked 5000 is not ours)');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'storage'->>'linked')::bigint,
  5000::bigint,
  'linked = the Drive bytes, reported separately');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'storage'->>'previews')::bigint,
  500::bigint,
  'previews = active assets only (the trashed one is counted as trash)');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'storage'->>'edits')::bigint,
  30::bigint,
  'edits = the third copy in R2, finally measured');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'storage'->>'trash')::bigint,
  730::bigint,
  'trash = original + previews of the deleted-not-purged asset');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'storage'->>'exports')::bigint,
  4000::bigint,
  'exports = artifacts still holding a result_key');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'storage'->>'total')::bigint,
  6260::bigint,
  'total = originals + previews + edits + exports + trash, and nothing else');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'archive'->>'photos')::int,
  2,
  'photos excludes both the trashed asset and the purged tombstone');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'credits'->>'total')::int,
  8,
  'credits = analyze + captions; embedding, search and export are free');

select is(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'credits'->>'searches')::int,
  7,
  'searches are still counted, just not charged');

-- ── RLS is the boundary ──────────────────────────────────────────────────
-- Passing someone else's workspace id is the whole attack: the parameter is not
-- a filter over rows the caller may see, it is a filter *within* them.
select is(
  (public.workspace_usage('00000000-0000-0000-0000-0000000000bb')->'storage'->>'originals')::bigint,
  0::bigint,
  'asking for another workspace returns zeros, not its 999999 bytes');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select ok(
  (public.workspace_usage('00000000-0000-0000-0000-00000000aaaa')->'plan') = 'null'::jsonb,
  'a non-member gets a null plan — no workspace row is readable');

select * from finish();
rollback;
