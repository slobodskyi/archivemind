-- One typed Trash (pgTAP) — run: `supabase test db`.
-- Covers migration 20260821000001 / ADR 0049: the `deleted_by` stamp that no
-- route writes, the drafts sweep that makes their "30 days" true, and
-- trash_items() — the union the whole Trash reads through. The three things
-- most worth pinning: a tenant cannot see another tenant's trash through the
-- function, the chip COUNTS ignore the type filter (or every chip but the
-- active one reads zero), and the totals follow the filter, because they are
-- what "Delete all (N)" quotes before deleting.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ── fixtures (as superuser) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Anna'),
  ('00000000-0000-0000-0000-0000000000b2', 'Borys');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000bbbb', 'WS-B', '00000000-0000-0000-0000-0000000000b2');
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b2', 'owner');
insert into public.projects (id, workspace_id, name, created_by) values
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-00000000aaaa', 'Live project',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000dda2', '00000000-0000-0000-0000-00000000aaaa', 'Doomed project',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000ddb2', '00000000-0000-0000-0000-00000000bbbb', 'B project',
   '00000000-0000-0000-0000-0000000000b2');
insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'pdf',   'A-brief'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-photo');
insert into public.files (asset_id, workspace_id, origin, r2_key, mime_type, byte_size) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'upload', 'k1', 'image/jpeg', 1000),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aaaa', 'upload', 'k2', 'application/pdf', 5000);
insert into public.asset_previews (asset_id, size, r2_key, byte_size) values
  ('00000000-0000-0000-0000-0000000000f1', 'thumb', 'k1-thumb', 100);
-- The photo lives in both of A's projects; one of them is about to be trashed,
-- which is the case `location` has to get right.
insert into public.project_assets (project_id, asset_id) values
  ('00000000-0000-0000-0000-00000000dda1', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000dda2', '00000000-0000-0000-0000-0000000000f1');
insert into public.boards (id, workspace_id, project_id, name, color, created_by) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-00000000dda1', 'Pitch', 'blue', '00000000-0000-0000-0000-0000000000a1');
insert into public.content_drafts (id, workspace_id, board_id, client_id, kind, name, document, created_by) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-0000000000e1', 'local-1', 'article', 'Odesa story', '{}'::jsonb,
   '00000000-0000-0000-0000-0000000000a1');

-- ── A trashes one of each ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

update public.assets set status = 'deleted' where id = '00000000-0000-0000-0000-0000000000f1';
select is((select deleted_by from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'deleting an asset stamps deleted_by from auth.uid(), with no route involved');

-- Restoring must clear it: "deleted by Anna" on a live photo would read as an
-- audit trail of something that did not happen.
update public.assets set status = 'active' where id = '00000000-0000-0000-0000-0000000000f1';
select is((select deleted_by from public.assets where id = '00000000-0000-0000-0000-0000000000f1'),
  null::uuid, 'restoring clears deleted_by along with the clock');

update public.assets set status = 'deleted'
  where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');
update public.projects set deleted_at = now() where id = '00000000-0000-0000-0000-00000000dda2';
update public.boards   set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000e1';
update public.content_drafts set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000c1';

select is((select deleted_by from public.projects where id = '00000000-0000-0000-0000-00000000dda2'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'a project stamped by its route still gets its actor from the trigger');
select is((select deleted_by from public.boards where id = '00000000-0000-0000-0000-0000000000e1'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'so does a Workspace');
select is((select deleted_by from public.content_drafts where id = '00000000-0000-0000-0000-0000000000c1'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'so does a draft');

-- ── the list ─────────────────────────────────────────────────────────────
select is((trash_items()->>'total')::int, 5,
  'two photos, a project, a Workspace and a draft arrive in ONE list');
select is((trash_items()->'counts'->>'photo')::int, 1,
  'an asset counts under its own kind, not under "asset"');
select is((trash_items()->'counts'->>'pdf')::int, 1,
  'a pdf is its own chip — a new asset_kind needs no change here');
select is((trash_items()->'counts'->>'workspace')::int, 1, 'a Workspace counts as itself');
select is((trash_items()->'counts'->>'draft')::int, 1, 'and so does a draft');

select is((trash_items(p_types => array['photo'])->>'total')::int, 1,
  'the type filter narrows the list');
select is((trash_items(p_types => array['photo'])->'counts'->>'pdf')::int, 1,
  'but NOT the counts — the chips must still say what picking them would find');
select is((trash_items(p_types => array['photo'])->>'total_bytes')::bigint, 1100::bigint,
  'bytes follow the filter and include previews, so "Delete all" can quote them');

select is(
  (trash_items(p_sort => 'largest')->'items'->0->>'name'), 'A-brief',
  'sorting by size puts the 5 KB brief ahead of the 1.1 KB photo');
select is(
  jsonb_array_length(trash_items(p_limit => 2)->'items'), 2,
  'the page respects p_limit');
select is((trash_items(p_limit => 2)->>'total')::int, 5,
  'while the total keeps counting what the page left out — the 500-row silence this replaces');
select is(
  jsonb_array_length(trash_items(p_limit => 2, p_offset => 4)->'items'), 1,
  'and p_offset walks the rest of it');

-- Where Restore puts it back — the trashed project must not be offered as a
-- destination, because a photo returned there is a photo you still cannot see.
select is(
  (select jsonb_array_length(i->'location')
     from jsonb_array_elements(trash_items(p_types => array['photo'])->'items') i),
  1, 'location names only the live project the photo returns to');
select is(
  (select i->'location'->0->>'name'
     from jsonb_array_elements(trash_items(p_types => array['photo'])->'items') i),
  'Live project', 'and names it, so Restore is not a guess');
select is(
  (select i->'deleted_by'->>'name'
     from jsonb_array_elements(trash_items(p_types => array['photo'])->'items') i),
  'Anna', 'the list carries who deleted it, resolved through profiles');

-- p_project is for the in-canvas panel: it scopes the project-scoped kinds and
-- deliberately leaves assets alone, which are workspace-global (as that panel's
-- own copy has always said).
select is((trash_items(p_project => '00000000-0000-0000-0000-00000000dda1')->'counts'->>'workspace')::int,
  1, 'p_project keeps a Workspace of that project');
select is((trash_items(p_project => '00000000-0000-0000-0000-00000000dda2')->'counts'->>'workspace')::int,
  null::int, 'and drops one belonging to another project');
select is((trash_items(p_project => '00000000-0000-0000-0000-00000000dda2')->'counts'->>'photo')::int,
  1, 'while trashed photos stay workspace-global');

-- ── isolation and tombstones ─────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((trash_items()->>'total')::int, 0,
  'another tenant sees none of it — RLS is the boundary, not a filter argument');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
reset role;
update public.assets set purged_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
set local role authenticated;
select is((trash_items()->'counts'->>'pdf')::int, null::int,
  'a purged tombstone leaves the Trash — nothing restorable, nothing shown');

-- ── the drafts sweep ─────────────────────────────────────────────────────
select is(sweep_trashed_drafts(interval '30 days'), 0,
  'the sweep leaves a freshly trashed draft alone');
reset role;
update public.content_drafts set deleted_at = now() - interval '31 days'
  where id = '00000000-0000-0000-0000-0000000000c1';
set local role authenticated;
select is(sweep_trashed_drafts(interval '30 days'), 1,
  'and hard-deletes one past the window, so the 30-day copy is true for drafts too');

select * from finish();
rollback;
