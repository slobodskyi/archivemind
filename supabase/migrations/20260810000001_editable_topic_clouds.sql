-- Editable Topic clouds — ADR 0042.
--
-- `assets.cluster_id` remains the worker's latest k-means answer. A person's
-- move is a different fact and must survive the next re-cluster, so it lives in
-- `topic_cluster_overrides` and wins only at read time:
--
--   effective topic = override.cluster_id ?? assets.cluster_id ?? heuristic
--
-- The split is what makes "Return to AI" lossless: delete one override and the
-- current machine answer is immediately visible again.

create type topic_cluster_origin as enum ('generated', 'manual');

-- Existing rows are all generated. Manual topics have no k-means centroid — a
-- person's pile is not a fake model result and must never enter centroid
-- matching. `is_renamed=true` is still useful for a manual row: PATCH /topics
-- follows the existing narrow label ACL, and every human name is pinned.
alter table public.topic_clusters
  add column origin topic_cluster_origin not null default 'generated',
  alter column centroid drop not null,
  add constraint topic_clusters_origin_centroid_check check (
    (origin = 'generated' and centroid is not null)
    or (origin = 'manual' and centroid is null)
  );

comment on column public.topic_clusters.origin is
  'generated = k-means output owned by the cluster worker; manual = a human-created Topic that the worker must never match, relabel or delete (ADR 0042).';
comment on column public.topic_clusters.centroid is
  'K-means stability anchor for generated clusters. NULL exactly for manual topics; a curated pile is not represented as a fabricated model centroid.';

-- One effective override per asset: Topic stays single-valued, just like the
-- packed tile is one physical object in one cloud. `workspace_id` is repeated
-- for RLS and is checked again inside every SECURITY DEFINER mutation below.
create table public.topic_cluster_overrides (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- RESTRICT is intentional defence in depth: even if a future worker delete
  -- forgets its NOT EXISTS guard, Postgres refuses to erase a human move. The
  -- manual-topic RPC explicitly deletes its own overrides first.
  cluster_id uuid not null references public.topic_clusters(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index topic_cluster_overrides_ws_cluster_idx
  on public.topic_cluster_overrides (workspace_id, cluster_id);

create trigger topic_cluster_overrides_updated_at
  before update on public.topic_cluster_overrides
  for each row execute function public.set_updated_at();

comment on table public.topic_cluster_overrides is
  'Human Topic assignment. It overrides assets.cluster_id at read time without destroying that AI baseline; deleting the row is Return to AI.';

-- `topic_clusters.size` remains the last machine membership count for generated
-- rows. For manual rows it is the live override count, maintained here so a
-- newly-created topic is immediately non-empty and listable even before a
-- canvas refresh. Generated destinations are deliberately untouched: their
-- size continues to describe the k-means baseline, not effective membership.
create or replace function public.adjust_manual_topic_cluster_size()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.topic_clusters
       set size = size + 1
     where id = new.cluster_id and origin = 'manual';
  elsif tg_op = 'DELETE' then
    update public.topic_clusters
       set size = greatest(size - 1, 0)
     where id = old.cluster_id and origin = 'manual';
  elsif old.cluster_id is distinct from new.cluster_id then
    update public.topic_clusters
       set size = greatest(size - 1, 0)
     where id = old.cluster_id and origin = 'manual';
    update public.topic_clusters
       set size = size + 1
     where id = new.cluster_id and origin = 'manual';
  end if;

  return null;
end;
$$;

create trigger topic_cluster_overrides_manual_size
  after insert or update of cluster_id or delete on public.topic_cluster_overrides
  for each row execute function public.adjust_manual_topic_cluster_size();

-- Authenticated callers may read overrides through RLS (the asset read and the
-- Topic menu both need them), but have NO direct write grant or write policy.
-- All mutation goes through the three narrow, atomic RPCs below; this prevents
-- a client from forging workspace_id on a row that the worker later trusts.
grant select on table public.topic_cluster_overrides to authenticated;
grant all on table public.topic_cluster_overrides to service_role;

alter table public.topic_cluster_overrides enable row level security;
create policy topic_cluster_overrides_select
  on public.topic_cluster_overrides for select
  using (public.is_member(workspace_id));

-- Create a manual topic and seed its membership in ONE transaction. The web
-- passes p_workspace_id only after resolving the caller's current membership;
-- the function independently re-checks is_editor because SECURITY DEFINER
-- bypasses table RLS. The advisory lock is the same one cluster.ts holds, so a
-- re-cluster cannot interleave a delete with this assignment.
create or replace function public.create_manual_topic(
  p_workspace_id uuid,
  p_label text,
  p_asset_ids uuid[]
)
returns table(topic_id uuid, topic_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_count int;
  v_requested_count int;
  v_topic_id uuid;
  v_label text := btrim(p_label);
begin
  if p_workspace_id is null or not public.is_editor(p_workspace_id) then
    raise insufficient_privilege using message = 'topic_editor_required';
  end if;
  if p_label is null or char_length(v_label) < 1 or char_length(v_label) > 60 then
    raise exception using errcode = '22023', message = 'invalid_topic_label';
  end if;
  if p_asset_ids is null
     or cardinality(p_asset_ids) < 1
     or cardinality(p_asset_ids) > 500
     or array_position(p_asset_ids, null) is not null then
    raise exception using errcode = '22023', message = 'invalid_topic_assets';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text));

  select count(distinct aid) into v_requested_count
    from unnest(p_asset_ids) as requested(aid);
  perform 1
    from public.assets a
   where a.workspace_id = p_workspace_id
     and a.status = 'active'
     and a.id = any(p_asset_ids)
   for update;
  get diagnostics v_asset_count = row_count;
  if v_asset_count <> v_requested_count then
    raise no_data_found using message = 'topic_assets_not_found';
  end if;

  insert into public.topic_clusters
    (workspace_id, label, size, centroid, origin, is_renamed)
  values
    (p_workspace_id, v_label, 0, null, 'manual', true)
  returning id into v_topic_id;

  insert into public.topic_cluster_overrides
    (asset_id, workspace_id, cluster_id, assigned_by)
  select distinct aid, p_workspace_id, v_topic_id, auth.uid()
    from unnest(p_asset_ids) as requested(aid)
  on conflict (asset_id) do update
    set workspace_id = excluded.workspace_id,
        cluster_id = excluded.cluster_id,
        assigned_by = excluded.assigned_by,
        updated_at = now();

  return query select v_topic_id, v_label;
end;
$$;

-- Move a selection into any existing topic, generated or manual. NULL is the
-- explicit Return-to-AI operation and deletes the override; it never writes
-- assets.cluster_id, so the current k-means answer remains intact throughout.
create or replace function public.assign_topic_assets(
  p_workspace_id uuid,
  p_asset_ids uuid[],
  p_cluster_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_count int;
  v_requested_count int;
begin
  if p_workspace_id is null or not public.is_editor(p_workspace_id) then
    raise insufficient_privilege using message = 'topic_editor_required';
  end if;
  if p_asset_ids is null
     or cardinality(p_asset_ids) < 1
     or cardinality(p_asset_ids) > 500
     or array_position(p_asset_ids, null) is not null then
    raise exception using errcode = '22023', message = 'invalid_topic_assets';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text));

  select count(distinct aid) into v_requested_count
    from unnest(p_asset_ids) as requested(aid);
  perform 1
    from public.assets a
   where a.workspace_id = p_workspace_id
     and a.status = 'active'
     and a.id = any(p_asset_ids)
   for update;
  get diagnostics v_asset_count = row_count;
  if v_asset_count <> v_requested_count then
    raise no_data_found using message = 'topic_assets_not_found';
  end if;

  if p_cluster_id is null then
    delete from public.topic_cluster_overrides o
     where o.workspace_id = p_workspace_id
       and o.asset_id = any(p_asset_ids);
    return true;
  end if;

  perform 1
    from public.topic_clusters tc
   where tc.workspace_id = p_workspace_id
     and tc.id = p_cluster_id
   for update;
  if not found then
    raise no_data_found using message = 'topic_not_found';
  end if;

  insert into public.topic_cluster_overrides
    (asset_id, workspace_id, cluster_id, assigned_by)
  select distinct aid, p_workspace_id, p_cluster_id, auth.uid()
    from unnest(p_asset_ids) as requested(aid)
  on conflict (asset_id) do update
    set workspace_id = excluded.workspace_id,
        cluster_id = excluded.cluster_id,
        assigned_by = excluded.assigned_by,
        updated_at = now();

  return true;
end;
$$;

-- Only a manual topic can be deleted through the product. Its overrides are
-- explicitly removed first in the same transaction, revealing each asset's
-- untouched AI baseline. Generated topics remain worker-owned and return false.
create or replace function public.delete_manual_topic(
  p_workspace_id uuid,
  p_cluster_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if p_workspace_id is null or not public.is_editor(p_workspace_id) then
    raise insufficient_privilege using message = 'topic_editor_required';
  end if;
  if p_cluster_id is null then
    raise exception using errcode = '22023', message = 'invalid_topic_id';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text));

  perform 1
    from public.topic_clusters tc
   where tc.workspace_id = p_workspace_id
     and tc.id = p_cluster_id
     and tc.origin = 'manual'
   for update;
  if not found then
    return false;
  end if;

  -- The FK is RESTRICT so no generic cluster delete can erase curation. This
  -- function is the one intentional exception: remove exactly this manual
  -- topic's assignments first, then its row, inside the same transaction.
  delete from public.topic_cluster_overrides o
   where o.workspace_id = p_workspace_id
     and o.cluster_id = p_cluster_id;

  delete from public.topic_clusters tc
   where tc.workspace_id = p_workspace_id
     and tc.id = p_cluster_id
     and tc.origin = 'manual';
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

-- New functions default to EXECUTE for PUBLIC. These three cross the RLS
-- boundary deliberately, so keep the callable surface exact.
revoke all on function public.create_manual_topic(uuid, text, uuid[]) from public, anon;
revoke all on function public.assign_topic_assets(uuid, uuid[], uuid) from public, anon;
revoke all on function public.delete_manual_topic(uuid, uuid) from public, anon;
grant execute on function public.create_manual_topic(uuid, text, uuid[]) to authenticated;
grant execute on function public.assign_topic_assets(uuid, uuid[], uuid) to authenticated;
grant execute on function public.delete_manual_topic(uuid, uuid) to authenticated;

-- Trigger-only; callers never need to invoke this directly.
revoke all on function public.adjust_manual_topic_cluster_size() from public, anon, authenticated;
