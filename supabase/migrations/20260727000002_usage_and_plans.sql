-- Usage & Storage: the plan catalog, the byte accounting that was never kept,
-- and one RPC that answers the whole page.
--
-- TECH_SPEC rule 11 says every AI action is logged in `usage_events` "for the
-- future credits model", and §13 puts billing enforcement out of MVP. That
-- promise held for the AI half and broke for everything else:
--
--   * `asset_previews` and `asset_edits` store only R2 keys, and the export job
--     stores only `payload.result_key` — so nothing in the database knows how
--     many bytes we are actually holding for a workspace. A storage meter built
--     on today's schema could show ONE honest number (originals, via
--     files.byte_size) and would have to invent the other four.
--   * `ingest` writes no usage_event at all, so storage growth is not
--     attributable over time even though every AI action is.
--   * `usage_events.cost_usd` and `ai_jobs.cost_usd` have existed since init and
--     are written by nobody.
--
-- This migration fixes the accounting, not the enforcement. Nothing here caps,
-- blocks or bills anything: `plans.enforced` is false for every row that ships,
-- and no policy or trigger reads a limit. The limits exist so the UI can draw a
-- denominator, and so the day enforcement lands it reads a number that has been
-- collected truthfully from the start rather than one invented at billing time.

-- ============ plan catalog ============
-- A table, not an enum: limits change without a migration, and a workspace's
-- plan is data. Null limit = unlimited (the UI drops the denominator and shows
-- a bare count instead of a meter).
create table plans (
  id text primary key,
  name text not null,
  storage_bytes bigint,             -- null = unlimited
  monthly_credits int,              -- null = unlimited
  enforced boolean not null default false,
  sort_order int not null default 0
);

comment on table plans is
  'Plan catalog for the Usage & Storage page. Limits are display-only until plans.enforced flips true — nothing in the schema reads them.';
comment on column plans.monthly_credits is
  '1 credit = 1 AI action on 1 photo (analyze, or one caption in one language). Search, export, ingest and clustering cost 0 — see packages/shared CREDIT_COST.';

-- Sized against the product's actual user: a documentary photographer whose
-- 24MP JPEGs run ~8 MB each. 50 GiB ≈ 6k photos (one reportage archive),
-- 500 GiB ≈ 60k, 2 TiB is the RAW-archive tier. Credits follow the same shape:
-- 5k/month analyses a 5k-photo import, or captions 2.5k photos in two languages.
insert into plans (id, name, storage_bytes, monthly_credits, enforced, sort_order) values
  ('beta',    'Free (beta)',        53687091200,   5000, false, 0),   --  50 GiB
  ('creator', 'Creator',           536870912000,  25000, false, 1),   -- 500 GiB
  ('studio',  'Studio',           2199023255552, 100000, false, 2);   --   2 TiB

alter table workspaces add column plan text not null default 'beta' references plans(id);

-- ============ byte accounting ============
-- The worker knows each of these sizes at the moment it uploads the buffer;
-- until now it threw the number away. Nullable on purpose: every row that
-- predates this migration is genuinely unmeasured, and the page says so rather
-- than pretending a zero is a fact. `scripts/backfill-derivative-bytes.ts`
-- fills them from R2 HeadObject.
alter table asset_previews add column byte_size bigint;
alter table asset_edits    add column thumb_bytes bigint,
                           add column medium_bytes bigint;

-- Bytes moved by an event that isn't measured in units (ingest). `units` is int
-- and would overflow on a large enough import; bytes gets its own bigint.
alter table usage_events add column bytes bigint;

comment on column usage_events.bytes is
  'Bytes this event added to (or removed from) stored data. Set by ingest; null for AI events, which are measured in units.';

-- ============ the page, as one query ============
-- SECURITY INVOKER, same reasoning as search_assets (20260717000001): RLS on
-- assets/files/usage_events/projects already scopes every row to the caller's
-- memberships, so `ws` narrows *within* that boundary rather than being it. A
-- non-member gets an object of zeros and a null plan, never another workspace's
-- numbers.
--
-- One function rather than a dozen round trips because the page loads all of it
-- at once. At today's scale (thousands of assets) the aggregates are a handful
-- of index scans. The moment this shows up in a page-load profile the answer is
-- a daily rollup table refreshed by the worker's existing 6-hourly sweeper, and
-- only this function's body changes — `lib/usage.ts` keeps its shape.
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
    coalesce(ae.thumb_bytes, 0) + coalesce(ae.medium_bytes, 0)       as edit_bytes,
    coalesce(pv.unmeasured, 0)                                       as unmeasured_previews,
    case when ae.asset_id is not null
          and (ae.thumb_bytes is null or ae.medium_bytes is null)
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

comment on function public.workspace_usage(uuid) is
  'Everything the Usage & Storage page renders, in one RLS-scoped round trip. SECURITY INVOKER: a non-member gets zeros and a null plan.';

-- ============ grants & RLS ============
-- init.sql:318 note: the bulk grant there only covered tables that existed then.
grant all on table plans to authenticated, service_role;
grant execute on function public.workspace_usage(uuid) to authenticated, service_role;

-- The price list is public by nature — every signed-in caller may read it, and
-- nobody writes it outside a migration.
alter table plans enable row level security;
create policy plans_select on plans for select to authenticated using (true);
