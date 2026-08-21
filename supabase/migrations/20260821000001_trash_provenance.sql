-- One typed Trash — ADR 0049.
--
-- Four things in this codebase are soft-deleted on a 30-day clock: projects
-- (20260713000001), assets (20260723000001), Workspaces (20260813000001) and
-- content drafts (20260814000001). Only the first three are visible anywhere,
-- across two different surfaces, and neither surface can answer the questions a
-- trash exists to answer: what kind of file is this, where does it go back to,
-- how much space will it free, who deleted it, and what disappears first.
--
-- This migration gives the Trash one source of truth:
--   1. `deleted_by` on all four tables, stamped by trigger (never by a route),
--   2. a sweep for drafts, so the "30 days" copy is true for every one of them,
--   3. `trash_items()` — the union, filtered/sorted/paged/counted in one place.
--
-- Why a function and not four client-side reads: sorting ("largest first"),
-- paging and an honest total across four tables cannot be assembled in the
-- browser without reading everything first, which is exactly what the current
-- hard limit of 500 (with no total) already gets wrong.

-- ============ 1. who deleted it ============

alter table assets         add column deleted_by uuid references profiles(id) on delete set null;
alter table projects       add column deleted_by uuid references profiles(id) on delete set null;
alter table boards         add column deleted_by uuid references profiles(id) on delete set null;
alter table content_drafts add column deleted_by uuid references profiles(id) on delete set null;

comment on column assets.deleted_by is
  'Who moved it to the Trash (ADR 0049). Stamped by trigger from auth.uid(), so '
  'every status writer agrees; null for rows trashed before this migration and '
  'for anything the worker deletes (service role has no auth.uid()).';
comment on column projects.deleted_by       is 'Who moved it to the Trash (ADR 0049) — stamped by trigger.';
comment on column boards.deleted_by         is 'Who moved it to the Trash (ADR 0049) — stamped by trigger.';
comment on column content_drafts.deleted_by is 'Who moved it to the Trash (ADR 0049) — stamped by trigger.';

-- assets already stamp their own clock on the status transition (ADR 0033); the
-- actor belongs in the same place, for the same reason — the delete route, the
-- restore route and both revive paths all write `status` and nothing else.
create or replace function public.stamp_asset_deleted_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'deleted' and old.status is distinct from 'deleted' then
    new.deleted_at := now();
    new.deleted_by := auth.uid();
  elsif new.status <> 'deleted' and old.status = 'deleted' then
    new.deleted_at := null;
    new.purged_at := null;
    new.deleted_by := null;
  end if;
  return new;
end $$;

-- projects / boards / drafts stamp `deleted_at` in their route handlers, so key
-- the actor off the column rather than off a status enum they do not have. A
-- restore clears it: "deleted by Anna" on a live project is a lie waiting to be
-- read as an audit trail.
create function public.stamp_deleted_by() returns trigger
language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := auth.uid();
  elsif new.deleted_at is null and old.deleted_at is not null then
    new.deleted_by := null;
  end if;
  return new;
end $$;

create trigger projects_stamp_deleted_by before update on projects
  for each row execute function stamp_deleted_by();
create trigger boards_stamp_deleted_by before update on boards
  for each row execute function stamp_deleted_by();
create trigger content_drafts_stamp_deleted_by before update on content_drafts
  for each row execute function stamp_deleted_by();

-- ============ 2. drafts get the clock they were promised ============
--
-- content_drafts has had `deleted_at` since 20260814000001 and no sweep, so a
-- "deleted" draft was kept forever and shown nowhere. Now that the Trash lists
-- them, the 30 days has to be real. A published /p/{token} is NOT affected:
-- publication_shares.source_draft_id is plain text carrying its own snapshot,
-- deliberately not a foreign key, precisely so a link outlives its draft (ADR 0046).
--
-- security INVOKER, exactly like sweep_trashed_projects / sweep_trashed_boards:
-- the worker connects as `postgres` and sweeps every tenant, while an
-- authenticated caller stays scoped by content_drafts_delete to their own.
create function sweep_trashed_drafts(retention interval default interval '30 days')
returns integer
language plpgsql
set search_path = public
as $$
declare
  removed integer;
begin
  delete from content_drafts
   where deleted_at is not null
     and deleted_at < now() - retention;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function sweep_trashed_drafts(interval) is
  'Hard-deletes trashed content drafts past the retention window (default 30 days, '
  'matching the Trash copy). Scheduled by apps/worker/src/retention.ts. Publication '
  'links are untouched — they carry their own snapshot (ADR 0046). See ADR 0049.';

-- Sweeps and the Trash list both scan the same tiny predicate.
create index content_drafts_trash_idx on content_drafts (deleted_at)
  where deleted_at is not null;
create index boards_trash_idx on boards (deleted_at)
  where deleted_at is not null;

-- ============ 3. the Trash, as one query ============
--
-- SECURITY INVOKER, same reasoning as workspace_usage / search_assets: RLS on
-- assets / projects / boards / content_drafts already scopes every row to the
-- caller's memberships, so this function narrows *within* that boundary rather
-- than being it. A non-member gets an empty list, never another tenant's trash.
--
-- Parameters:
--   p_types          filter keys to keep. A key is the item's KIND, except for
--                    an asset, where it is the asset's own kind — so the chips
--                    are project | workspace | draft | photo | pdf | document |
--                    other and a new asset_kind needs no change here or in the
--                    UI. null/empty = everything.
--   p_project        scopes the PROJECT-SCOPED kinds only (Workspaces and the
--                    drafts written inside them). Trashed assets and projects
--                    are workspace-global and always listed — which is what the
--                    in-canvas panel has always shown, and what its own copy says.
--   p_expiring_days  keep only what expires within N days (the "expiring soon" chip).
--   p_sort           recent (default) | expiring | largest | name.
--
-- Returns one object: the page, the totals the destructive buttons must quote,
-- and the per-key counts the chips render — counts ignore p_types on purpose,
-- or every chip but the active one would read zero.
create or replace function public.trash_items(
  p_types         text[] default null,
  p_project       uuid   default null,
  p_query         text   default null,
  p_sort          text   default 'recent',
  p_expiring_days int    default null,
  p_limit         int    default 60,
  p_offset        int    default 0
)
returns jsonb
language sql stable
set search_path = public
as $$
with
retention as (select interval '30 days' as span),
raw as (
  -- Projects. No bytes: trashing a project frees nothing, because its photos
  -- stay active in the archive (sweep_trashed_projects deletes the row alone).
  -- Saying "0 B" would be a lie of a different kind, so bytes stay null and the
  -- UI prints a dash.
  select 'project'::text            as kind,
         p.id                       as id,
         p.name                     as name,
         null::text                 as asset_kind,
         null::text                 as mime,
         (select ap.r2_key
            from project_assets pa
            join assets a2 on a2.id = pa.asset_id and a2.status = 'active'
            join asset_previews ap on ap.asset_id = a2.id and ap.size = 'thumb'
           where pa.project_id = p.id
           limit 1)                 as thumb_key,
         null::text                 as color,
         null::bigint               as bytes,
         (select count(*)
            from project_assets pa
            join assets a2 on a2.id = pa.asset_id and a2.status = 'active'
           where pa.project_id = p.id)::int as item_count,
         '[]'::jsonb                as location,
         p.deleted_at               as deleted_at,
         p.deleted_by               as deleted_by
    from projects p
   where p.deleted_at is not null

  union all

  -- Workspaces. Also no bytes — a Workspace is a curated subset, not a
  -- container of files (ADR 0044); restoring one brings its photos back with it
  -- only because they were never deleted in the first place.
  select 'workspace', b.id, b.name, null, null, null, b.color::text,
         null::bigint,
         (select count(*) from board_assets ba where ba.board_id = b.id)::int,
         jsonb_build_array(jsonb_build_object('id', pr.id, 'name', pr.name)),
         b.deleted_at, b.deleted_by
    from boards b
    join projects pr on pr.id = b.project_id
   where b.deleted_at is not null
     and (p_project is null or b.project_id = p_project)

  union all

  -- Assets — the only kind that holds reclaimable bytes, counted the same way
  -- workspace_usage counts them (original + previews + edited previews) so the
  -- Trash's "4.7 GB" and the storage card's `trash` slice cannot disagree.
  -- Purged tombstones are excluded: nothing restorable, nothing shown (ADR 0033).
  select 'asset', a.id, coalesce(a.title, 'untitled'), a.kind::text, f.mime,
         coalesce(ae.edited_thumb_key, pv.thumb_key), null::text,
         (coalesce(f.stored, 0) + coalesce(pv.bytes, 0)
          + coalesce(ae.thumb_bytes, 0) + coalesce(ae.medium_bytes, 0))::bigint,
         null::int,
         coalesce(loc.projects, '[]'::jsonb),
         a.deleted_at, a.deleted_by
    from assets a
    left join lateral (
      select sum(fl.byte_size) filter (where fl.r2_key is not null) as stored,
             min(fl.mime_type)                                      as mime
        from files fl where fl.asset_id = a.id
    ) f on true
    left join lateral (
      select sum(ap.byte_size)                                   as bytes,
             max(ap.r2_key) filter (where ap.size = 'thumb')     as thumb_key
        from asset_previews ap where ap.asset_id = a.id
    ) pv on true
    left join asset_edits ae on ae.asset_id = a.id
    left join lateral (
      -- Where Restore puts it back. A project that is itself in the Trash is
      -- left out: naming it as the destination would promise a return to
      -- somewhere the photo cannot be seen.
      select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name) as projects
        from project_assets pa
        join projects pr on pr.id = pa.project_id and pr.deleted_at is null
       where pa.asset_id = a.id
    ) loc on true
   where a.status = 'deleted'
     and a.purged_at is null

  union all

  -- Drafts. Listed here because ADR 0049's rule is that no soft delete exists
  -- outside the Trash — until now this row was deleted, kept forever, and shown
  -- nowhere at all.
  select 'draft', d.id, d.name, null, null, null, b.color::text,
         null::bigint, null::int,
         jsonb_build_array(jsonb_build_object('id', b.id, 'name', b.name)),
         d.deleted_at, d.deleted_by
    from content_drafts d
    join boards b on b.id = d.board_id
   where d.deleted_at is not null
     and (p_project is null or b.project_id = p_project)
),
keyed as (
  select r.kind, r.id, r.name, r.asset_kind, r.mime, r.thumb_key, r.color,
         r.bytes, r.item_count, r.location, r.deleted_at,
         case when r.deleted_by is null then null
              else jsonb_build_object(
                'id', r.deleted_by,
                'name', coalesce(nullif(btrim(pf.display_name), ''), 'Someone'))
         end                                                    as deleted_by,
         case when r.kind = 'asset' then r.asset_kind else r.kind end as filter_key,
         r.deleted_at + (select span from retention)          as expires_at
    from raw r
    left join profiles pf on pf.id = r.deleted_by
),
-- The query narrows what the chips count; the type and expiry chips do not, or
-- picking one would zero the others.
matched as (
  select * from keyed
   where p_query is null
      or btrim(p_query) = ''
      or name ilike '%' || btrim(p_query) || '%'
),
filtered as (
  select * from matched
   where (p_types is null or cardinality(p_types) = 0 or filter_key = any(p_types))
     and (p_expiring_days is null
          or expires_at <= now() + make_interval(days => p_expiring_days))
),
page as (
  select f.kind, f.id, f.name, f.asset_kind, f.mime, f.thumb_key, f.color,
         f.bytes, f.item_count, f.location, f.deleted_at, f.deleted_by, f.expires_at,
         row_number() over (
           order by
             case when p_sort = 'name'     then lower(f.name)  end asc  nulls last,
             case when p_sort = 'largest'  then f.bytes        end desc nulls last,
             case when p_sort = 'expiring' then f.expires_at   end asc  nulls last,
             case when p_sort not in ('name', 'largest', 'expiring')
                  then f.deleted_at end desc nulls last,
             lower(f.name) asc
         ) as rn
    from filtered f
)
select jsonb_build_object(
  'items', coalesce((
    select jsonb_agg(to_jsonb(pg) - 'rn' order by pg.rn)
      from (select * from page where rn > greatest(p_offset, 0)
                                 and rn <= greatest(p_offset, 0) + greatest(p_limit, 0)) pg
  ), '[]'::jsonb),
  -- What the header prints and what "Delete all (N)" is allowed to act on: the
  -- CURRENT filter, never the whole table (ADR 0049 — a destructive button may
  -- not act on rows the filter is hiding).
  'total',       (select count(*) from filtered),
  'total_bytes', (select coalesce(sum(bytes), 0)::bigint from filtered),
  'oldest_expires_at', (select min(expires_at) from filtered),
  'counts', coalesce((
    select jsonb_object_agg(filter_key, n)
      from (select filter_key, count(*)::int as n from matched group by filter_key) c
  ), '{}'::jsonb),
  'expiring_soon', (
    select count(*)::int from matched
     where expires_at <= now() + interval '3 days'
  ),
  'retention_days', (select extract(day from span)::int from retention)
)
$$;

comment on function public.trash_items(text[], uuid, text, text, int, int, int) is
  'The Trash as one page: trashed projects, Workspaces, assets and content drafts '
  'in one filtered/sorted/paged list, with the totals a destructive button must '
  'quote and the per-key counts the chips render. SECURITY INVOKER — RLS is the '
  'tenant boundary. Returns R2 KEYS, never presigned URLs; the route presigns the '
  'page it renders. See ADR 0049.';

revoke all on function public.trash_items(text[], uuid, text, text, int, int, int)
  from public, anon;
grant execute on function public.trash_items(text[], uuid, text, text, int, int, int)
  to authenticated, service_role;
