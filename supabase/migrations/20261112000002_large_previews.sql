-- A 2048 px preview tier — ADR 0055 (amends ADR 0030 and ADR 0054).
--
-- Until now the largest picture any view could draw was the 1024 px `medium`
-- webp. The fullscreen viewer (ADR 0054) fits a photo to the whole screen, and
-- a laptop's retina screen is ~2900 device px wide, so even "fit" was a 2–3×
-- upscale. Originals solve that only for files held in R2 that a browser can
-- decode, so Drive, OneDrive, RAW, TIFF, HEIC outside WebKit and every edited
-- photo stayed soft.
--
-- The new size needs no schema for the unedited previews: asset_previews.size
-- is free text ('thumb' | 'medium' | now 'large'), and every reader that wants
-- one size already filters on it. The worker writes `large` at ingest from now
-- on and backfills older R2-held originals in the background; files whose
-- original lives in Drive or OneDrive get it only when imported anew (the
-- backfill never fetches from a cloud with a user's token).
--
-- An EDITED photo needs its own 2048 px render — the viewer must never show
-- the unedited large preview of an edited photo — so asset_edits gains the
-- third key and its byte count, beside the two it has carried since
-- 20260722000003 / 20260727000002. Both are null on an edit rendered before
-- this (or of a photo with no large preview): the viewer then stays at the
-- edited medium, and storage accounting reads null as "no such file", not as
-- "unmeasured", because no file was ever written.
--
-- The custody model is unchanged: the worker writes asset_edits as `postgres`
-- and bypasses RLS; authenticated users still have no INSERT/UPDATE policy, so
-- a forged edited_large_key cannot point the read path at an arbitrary object
-- (supabase/tests/005_image_edits.sql).

alter table asset_edits add column edited_large_key text,
                        add column large_bytes bigint;

comment on column asset_edits.edited_large_key is
  'The worker''s 2048 px render of the edit, {workspace_id}/edits/{asset_id}/large.webp. Null when the edit was rendered without a large source (ADR 0055).';

-- ============ storage accounting ============
-- workspace_usage() and trash_items() each add an edit's bytes to the asset's
-- total by naming the columns. Both are re-created below VERBATIM except for
-- that sum (and, in workspace_usage, the "unmeasured" test), so the storage
-- card and the Trash keep agreeing to the byte. CREATE OR REPLACE keeps the
-- functions' owners, grants and comments.

create or replace function public.workspace_usage(ws uuid)
returns jsonb
language sql stable
set search_path = public
as $$
with
period as (
  -- Calendar month, deliberately. Anniversary billing needs a per-workspace
  -- period start; adding that column later changes this CTE and nothing else.
  select date_trunc('month', now())                        as p_start,
         date_trunc('month', now()) + interval '1 month'   as p_end
),
plan_row as (
  select p.id, p.name, p.storage_bytes, p.monthly_credits, p.enforced
  from workspaces w
  join plans p on p.id = w.plan
  where w.id = ws
),
-- Per-asset byte rollup, computed once and split by lifecycle below. Lateral
-- single-row aggregates keep this on files_asset_idx / the asset_previews PK
-- instead of a correlated subquery per column.
asset_bytes as (
  select
    a.id,
    a.status,
    a.ai_processed_at,
    coalesce(f.stored, 0)                                            as original_bytes,
    coalesce(f.linked, 0)                                            as linked_bytes,
    coalesce(pv.bytes, 0)                                            as preview_bytes,
    coalesce(ae.thumb_bytes, 0) + coalesce(ae.medium_bytes, 0)
      + coalesce(ae.large_bytes, 0)                                  as edit_bytes,
    coalesce(pv.unmeasured, 0)                                       as unmeasured_previews,
    case when ae.asset_id is not null
          and (ae.thumb_bytes is null or ae.medium_bytes is null
               or (ae.edited_large_key is not null and ae.large_bytes is null))
         then 1 else 0 end                                           as unmeasured_edit
  from assets a
  left join lateral (
    select sum(fl.byte_size) filter (where fl.r2_key is not null) as stored,
           sum(fl.byte_size) filter (where fl.r2_key is null)     as linked
    from files fl where fl.asset_id = a.id
  ) f on true
  left join lateral (
    select sum(ap.byte_size)                              as bytes,
           count(*) filter (where ap.byte_size is null)   as unmeasured
    from asset_previews ap where ap.asset_id = a.id
  ) pv on true
  left join asset_edits ae on ae.asset_id = a.id
  where a.workspace_id = ws
    -- A purged tombstone holds no bytes and is not a photo. It stays in the
    -- table only so dedup can recognise the hash (ADR 0033); it must not show
    -- up in a count of the archive.
    and a.purged_at is null
),
live as (
  select
    coalesce(sum(original_bytes) filter (where status <> 'deleted'), 0)::bigint as originals,
    coalesce(sum(linked_bytes)   filter (where status <> 'deleted'), 0)::bigint as linked,
    coalesce(sum(preview_bytes)  filter (where status <> 'deleted'), 0)::bigint as previews,
    coalesce(sum(edit_bytes)     filter (where status <> 'deleted'), 0)::bigint as edits,
    coalesce(sum(original_bytes + preview_bytes + edit_bytes)
             filter (where status = 'deleted'), 0)::bigint                      as trash,
    coalesce(sum(unmeasured_previews), 0)::int                                  as unmeasured_previews,
    coalesce(sum(unmeasured_edit), 0)::int                                      as unmeasured_edits,
    (count(*) filter (where status <> 'deleted'))::int                          as photos,
    (count(*) filter (where status <> 'deleted'
                        and ai_processed_at is not null))::int                  as analyzed,
    (count(*) filter (where status = 'deleted'))::int                           as trashed
  from asset_bytes
),
-- `payload ? 'result_key'` IS the "artifact still in R2" test: sweepExpiredExports
-- deletes the object and strips that key, so expired exports drop out of the
-- storage total on their own.
exports as (
  select coalesce(sum((j.payload->>'result_bytes')::bigint), 0)::bigint          as bytes,
         (count(*) filter (where j.payload->>'result_bytes' is null))::int       as unmeasured,
         count(*)::int                                                           as artifacts
  from ai_jobs j
  where j.workspace_id = ws and j.type = 'export' and j.payload ? 'result_key'
),
captioned as (
  select count(distinct c.asset_id)::int as n
  from captions c
  join assets a on a.id = c.asset_id
  where a.workspace_id = ws and a.status <> 'deleted'
),
facts_confirmed as (
  select count(*)::int as n
  from facts fc
  join assets a on a.id = fc.asset_id
  where a.workspace_id = ws and a.status <> 'deleted' and fc.status = 'confirmed'
),
-- Credits are AI-only by design (see packages/shared CREDIT_COST). 'embedding'
-- is excluded because it is the second half of one analyze call, not a second
-- billable action — counting it would double every analysis.
month_usage as (
  select
    coalesce(sum(u.units) filter (where u.event_type = 'image_analyzed'), 0)::int    as analyze_credits,
    coalesce(sum(u.units) filter (where u.event_type = 'caption_generated'), 0)::int as caption_credits,
    coalesce(sum(u.units) filter (where u.event_type = 'search_query'), 0)::int      as searches,
    coalesce(sum(u.units) filter (where u.event_type = 'export'), 0)::int            as export_units,
    coalesce(sum(u.bytes) filter (where u.event_type = 'asset_ingested'), 0)::bigint as ingested_bytes
  from usage_events u, period
  where u.workspace_id = ws and u.created_at >= period.p_start
),
-- An asset can belong to several projects, so these rows deliberately do not
-- sum to the workspace total — each project reports what it draws on. The UI
-- says so.
by_project as (
  select p.id::text as id, p.name,
         count(ab.id)::int                                                   as photos,
         coalesce(sum(ab.original_bytes + ab.preview_bytes + ab.edit_bytes), 0)::bigint as bytes
  from projects p
  left join project_assets pa on pa.project_id = p.id
  left join asset_bytes ab on ab.id = pa.asset_id and ab.status <> 'deleted'
  where p.workspace_id = ws and p.deleted_at is null
  group by p.id, p.name
),
unassigned as (
  select count(*)::int                                                       as photos,
         coalesce(sum(ab.original_bytes + ab.preview_bytes + ab.edit_bytes), 0)::bigint as bytes
  from asset_bytes ab
  where ab.status <> 'deleted'
    and not exists (select 1 from project_assets pa where pa.asset_id = ab.id)
),
-- Grouped over files, not assets: origin lives on the file, and a Drive-linked
-- file's bytes are the whole point of this breakdown (they sit in Drive, not in
-- our R2, so they cost the workspace nothing but previews).
by_source as (
  select fl.origin::text as origin,
         count(distinct fl.asset_id)::int                                             as photos,
         coalesce(sum(fl.byte_size) filter (where fl.r2_key is not null), 0)::bigint  as stored_bytes,
         coalesce(sum(fl.byte_size) filter (where fl.r2_key is null), 0)::bigint      as linked_bytes
  from files fl
  join assets a on a.id = fl.asset_id
  where fl.workspace_id = ws and a.status <> 'deleted' and a.purged_at is null
  group by fl.origin
),
daily as (
  -- Aliased as g(at) rather than a bare `d`: a function-in-FROM's alias and its
  -- single output column would otherwise share a name, and `d::date` is then
  -- ambiguous between the column and the whole row.
  select g.at::date as day,
         coalesce(sum(u.units) filter (
           where u.event_type in ('image_analyzed', 'caption_generated')), 0)::int as credits
  from generate_series(date_trunc('day', now()) - interval '29 days',
                       date_trunc('day', now()), interval '1 day') as g(at)
  left join usage_events u
    on u.workspace_id = ws and u.created_at >= g.at and u.created_at < g.at + interval '1 day'
  group by g.at
),
-- One line per job, not per photo: a 120-photo caption run is one thing the
-- user did. Events with no job (search) collapse per day for the same reason.
recent_raw as (
  select coalesce(u.job_id::text, u.event_type || '@' || u.created_at::date::text) as k,
         max(u.job_id::text)          as job_id,
         u.event_type,
         max(u.created_at)            as at,
         sum(u.units)::int            as units,
         coalesce(sum(u.bytes), 0)::bigint as bytes
  from usage_events u
  where u.workspace_id = ws and u.event_type <> 'embedding'
  group by 1, u.event_type
  order by max(u.created_at) desc
  limit 8
),
recent as (
  select r.event_type, r.at, r.units, r.bytes, pr.name as project
  from recent_raw r
  left join ai_jobs j on j.id = r.job_id::uuid
  left join projects pr on pr.id = j.project_id
  order by r.at desc
)
select jsonb_build_object(
  'plan', (select to_jsonb(plan_row) from plan_row),
  -- Emitted as plain dates, not timestamptz. A timestamptz serializes with the
  -- server's UTC offset, and the UI formats in UTC to keep the server render
  -- and the browser render identical — so on a non-UTC database "1 Aug
  -- 00:00+03" would reach the reset line as "31 Jul". A date has no offset to
  -- get lost. The comparisons above still use the timestamptz values.
  'period', jsonb_build_object(
    'start', (select p_start::date from period),
    'end',   (select p_end::date from period)
  ),
  'storage', (
    select jsonb_build_object(
      'originals', live.originals,
      'previews',  live.previews,
      'edits',     live.edits,
      'exports',   exports.bytes,
      'trash',     live.trash,
      'total',     live.originals + live.previews + live.edits + exports.bytes + live.trash,
      'linked',    live.linked,
      'unmeasured', jsonb_build_object(
        'previews', live.unmeasured_previews,
        'edits',    live.unmeasured_edits,
        'exports',  exports.unmeasured
      )
    ) from live, exports
  ),
  'credits', (
    select jsonb_build_object(
      'analyze',  analyze_credits,
      'captions', caption_credits,
      'total',    analyze_credits + caption_credits,
      'searches', searches,
      'exports',  export_units,
      'ingested_bytes', ingested_bytes
    ) from month_usage
  ),
  'archive', (
    select jsonb_build_object(
      'photos',          live.photos,
      'analyzed',        live.analyzed,
      'captioned',       captioned.n,
      'facts_confirmed', facts_confirmed.n,
      'trashed',         live.trashed,
      'exports',         exports.artifacts
    ) from live, captioned, facts_confirmed, exports
  ),
  'by_project', coalesce((select jsonb_agg(to_jsonb(by_project) order by bytes desc, name) from by_project), '[]'::jsonb),
  'unassigned', (select to_jsonb(unassigned) from unassigned),
  'by_source',  coalesce((select jsonb_agg(to_jsonb(by_source) order by stored_bytes desc) from by_source), '[]'::jsonb),
  'daily',      coalesce((select jsonb_agg(to_jsonb(daily) order by day) from daily), '[]'::jsonb),
  'recent',     coalesce((select jsonb_agg(to_jsonb(recent) order by at desc) from recent), '[]'::jsonb)
);
$$;

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
          + coalesce(ae.thumb_bytes, 0) + coalesce(ae.medium_bytes, 0)
          + coalesce(ae.large_bytes, 0))::bigint,
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
