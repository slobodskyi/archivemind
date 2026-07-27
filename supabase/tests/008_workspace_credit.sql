-- workspaces credit/rights columns (pgTAP) — run: `supabase test db`.
-- Migration 20260727000001. These carry the byline onto exported deliverables
-- (ADR 0035 amendments), so what matters is: an owner can write them, a
-- non-owner member can read but NOT write, and a stranger sees nothing at all.
-- No new policy was added — this pins that the existing workspaces_update
-- (is_owner) and workspaces_select (is_member) already give exactly that.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ── fixtures (as superuser) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'editor@test.dev'),
  ('00000000-0000-0000-0000-0000000000c3', 'stranger@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner'),
  ('00000000-0000-0000-0000-0000000000b2', 'Editor'),
  ('00000000-0000-0000-0000-0000000000c3', 'Stranger');
insert into public.workspaces (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000aaaa', 'WS-A', '00000000-0000-0000-0000-0000000000a1');
insert into public.memberships (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000b2', 'editor');

-- ── shape ────────────────────────────────────────────────────────────────
select has_column('public', 'workspaces', 'creator', 'workspaces.creator exists');
select has_column('public', 'workspaces', 'credit', 'workspaces.credit exists');
select has_column('public', 'workspaces', 'copyright_notice', 'workspaces.copyright_notice exists');
select has_column('public', 'workspaces', 'usage_terms', 'workspaces.usage_terms exists');

-- Nullable by design: an archive with no byline is a valid state, and a NOT NULL
-- would have broken every existing workspace row.
select col_is_null('public', 'workspaces', 'credit', 'credit is nullable — no byline is a valid state');

-- ── owner writes ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$update public.workspaces
       set creator = 'O. Slobodskyi',
           credit = 'Photo: O. Slobodskyi',
           copyright_notice = '(c) 2026 O. Slobodskyi',
           usage_terms = 'Editorial use only.'
     where id = '00000000-0000-0000-0000-00000000aaaa'$$,
  'owner sets the credit block');

-- ── non-owner member: reads, cannot write ────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is(
  (select credit from public.workspaces where id = '00000000-0000-0000-0000-00000000aaaa'),
  'Photo: O. Slobodskyi',
  'editor member reads the credit (needed to render it in the export dialog)');

-- RLS makes a forbidden UPDATE affect zero rows rather than raise.
update public.workspaces set credit = 'Photo: someone else'
 where id = '00000000-0000-0000-0000-00000000aaaa';
select is(
  (select credit from public.workspaces where id = '00000000-0000-0000-0000-00000000aaaa'),
  'Photo: O. Slobodskyi',
  'editor member cannot rewrite the credit — workspaces_update is is_owner');

-- ── stranger sees nothing ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select is(
  (select count(*)::int from public.workspaces where id = '00000000-0000-0000-0000-00000000aaaa'),
  0,
  'a non-member sees no workspace row at all, credit included');

select * from finish();
rollback;
