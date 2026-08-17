-- OneDrive source plumbing (pgTAP) — run: `supabase test db`. ADR 0047.
--
-- The brief that specified this feature said "no RLS policy changes needed:
-- files and source_connections are already covered by is_member(workspace_id)"
-- and then, correctly, "add a test proving cross-workspace reads are denied —
-- do not assume inheritance works". This is that test, and it also pins the two
-- things about source_connections that ARE easy to get wrong:
--
--   * provider_metadata must be readable by an authenticated member. That table
--     carries COLUMN-level grants (init.sql:365 revokes table-wide select and
--     re-grants a fixed list), so a column added later is invisible until it is
--     granted — and the failure mode is a `select *` that starts erroring for
--     everyone, not just for the new column.
--   * refresh_token_enc must stay unreadable. Granting the new column must not
--     turn into re-granting the table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

-- One OneDrive connection per workspace, each holding a token ciphertext and
-- the provider_metadata the picker-less browse path reads back.
insert into public.source_connections
    (id, workspace_id, user_id, provider, provider_account_email,
     refresh_token_enc, status, provider_metadata) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000aaaa',
   '00000000-0000-0000-0000-0000000000a1', 'onedrive', 'a@live.test',
   'ciphertext-A', 'active', '{"driveId":"drive-A","accountType":"personal"}'::jsonb),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000bbbb',
   '00000000-0000-0000-0000-0000000000b2', 'onedrive', 'b@live.test',
   'ciphertext-B', 'active', '{"driveId":"drive-B","accountType":"business"}'::jsonb);

insert into public.assets (id, workspace_id, kind, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aaaa', 'photo', 'A-photo'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000bbbb', 'photo', 'B-photo');

-- origin='onedrive' with the composite (driveId, itemId) identity split across
-- source_drive_id and source_file_id — the shape 20260817000002 exists for.
insert into public.files
    (id, asset_id, workspace_id, origin, source_connection_id,
     source_drive_id, source_file_id, r2_key, mime_type) values
  ('00000000-0000-0000-0000-00000000f1f1', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-00000000aaaa', 'onedrive', '00000000-0000-0000-0000-0000000000c1',
   'drive-A', 'item-A', null, 'image/jpeg'),
  ('00000000-0000-0000-0000-00000000f2f2', '00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-00000000bbbb', 'onedrive', '00000000-0000-0000-0000-0000000000c2',
   'drive-B', 'item-B', null, 'image/jpeg');

-- ── the enum values actually landed ─────────────────────────────────────
-- Cheap, but the two-file split in 20260817000001 is exactly the kind of thing
-- that silently half-applies.
select ok(
  'onedrive' = any (enum_range(null::source_provider)::text[]),
  'source_provider carries onedrive');
select ok(
  'onedrive' = any (enum_range(null::file_origin)::text[]),
  'file_origin carries onedrive');

-- ── user A ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from public.files where origin = 'onedrive'),
  1, 'A sees only its own OneDrive-origin file');

select is(
  (select source_drive_id from public.files
    where id = '00000000-0000-0000-0000-00000000f1f1'),
  'drive-A', 'A reads its own file''s drive scope');

select is(
  (select count(*)::int from public.files
    where id = '00000000-0000-0000-0000-00000000f2f2'),
  0, 'A cannot read workspace B''s OneDrive-origin file');

select is(
  (select count(*)::int from public.source_connections),
  1, 'A sees only its own connection row');

select is(
  (select count(*)::int from public.source_connections
    where id = '00000000-0000-0000-0000-0000000000c2'),
  0, 'A cannot read workspace B''s OneDrive connection');

-- The column grant from 20260817000002. Without it this select raises 42501
-- rather than returning a row, which is why it is asserted and not assumed.
select is(
  (select provider_metadata->>'driveId' from public.source_connections
    where id = '00000000-0000-0000-0000-0000000000c1'),
  'drive-A', 'a member can read provider_metadata on its own connection');

-- ...and the grant did not widen into the token columns.
select throws_ok(
  $$select refresh_token_enc from public.source_connections
      where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '42501', null, 'refresh_token_enc stays unreadable to an authenticated member');

-- ── user B ───────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is(
  (select provider_metadata->>'accountType' from public.source_connections
    where id = '00000000-0000-0000-0000-0000000000c2'),
  'business', 'B reads its own connection, not A''s');

select * from finish();
rollback;
