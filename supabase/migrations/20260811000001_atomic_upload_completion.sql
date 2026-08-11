-- Atomic, idempotent local-upload completion (issue #194).
--
-- The browser has already PUT each object into R2 when it calls this RPC. The
-- database side must therefore be all-or-nothing: an asset without its file,
-- a project link added after ingest starts, or an ambiguous response that a
-- retry duplicates are all integrity failures. One function call is one
-- Postgres transaction and one ledger key makes an exact replay harmless.

create table public.upload_completions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  completion_id uuid not null,
  created_by uuid not null references public.profiles(id),
  request_payload jsonb not null,
  asset_ids uuid[] not null,
  job_id uuid not null references public.ai_jobs(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, completion_id),
  check (cardinality(asset_ids) between 1 and 100)
);

comment on table public.upload_completions is
  'Idempotency ledger for one exact local-upload completion request. Rows are private infrastructure: clients replay through complete_upload_batch, never this table.';
comment on column public.upload_completions.request_payload is
  'Canonical JSONB {project_id, uploads}; exact JSONB equality plus created_by defines a safe replay.';

-- No authenticated direct access: exposing the ledger would disclose every
-- uploaded object key in the workspace and letting clients write it would let
-- them forge successful completions. The SECURITY DEFINER RPC below is the
-- only authenticated surface; service_role retains operational access.
revoke all on table public.upload_completions from public, anon, authenticated;
grant all on table public.upload_completions to service_role;

alter table public.upload_completions enable row level security;

create or replace function public.complete_upload_batch(
  p_workspace_id uuid,
  p_project_id uuid,
  p_completion_id uuid,
  p_uploads jsonb
)
returns table(asset_ids uuid[], job_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_existing public.upload_completions%rowtype;
  v_upload jsonb;
  v_asset_ids uuid[] := array[]::uuid[];
  v_r2_keys text[] := array[]::text[];
  v_r2_key text;
  v_filename text;
  v_mime text;
  v_byte_size numeric;
  v_prefix text := p_workspace_id::text || '/originals/';
  v_job_id uuid;
begin
  -- SECURITY DEFINER bypasses table RLS, so tenancy and the write role are
  -- checked explicitly before either the ledger or domain rows are touched.
  if v_actor is null
     or p_workspace_id is null
     or public.is_editor(p_workspace_id) is not true then
    raise insufficient_privilege using message = 'upload_editor_required';
  end if;

  -- Keep type and shape checks separate: PostgreSQL does not promise boolean
  -- subexpression order, and jsonb_array_length(non_array) must never leak a
  -- different database error through this public validation boundary.
  if p_completion_id is null
     or jsonb_typeof(p_uploads) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_upload_completion';
  end if;
  if jsonb_array_length(p_uploads) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_upload_completion';
  end if;

  -- The route passes this already-normalized snake_case payload. JSONB gives
  -- stable object-key ordering, while array order remains the caller's input
  -- order and is reflected exactly by the returned asset_ids.
  v_request := jsonb_build_object(
    'project_id', p_project_id,
    'uploads', p_uploads
  );

  -- Serialize first-use and replay for this composite key. A 64-bit hash
  -- collision only makes unrelated calls wait; correctness still comes from
  -- the ledger PK and exact actor/payload comparison below.
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_completion_id::text, 0)
  );

  select uc.*
    into v_existing
    from public.upload_completions uc
   where uc.workspace_id = p_workspace_id
     and uc.completion_id = p_completion_id;

  if found then
    if v_existing.created_by <> v_actor
       or v_existing.request_payload is distinct from v_request then
      raise unique_violation using message = 'upload_completion_conflict';
    end if;

    return query select v_existing.asset_ids, v_existing.job_id;
    return;
  end if;

  -- A project is optional, but when present it must be in this exact tenant.
  -- Locking the row prevents a concurrent hard-delete between validation and
  -- inserting project_assets. Missing and cross-tenant ids use the same error.
  if p_project_id is not null then
    perform 1
      from public.projects p
     where p.id = p_project_id
       and p.workspace_id = p_workspace_id
     for key share;
    if not found then
      raise no_data_found using message = 'upload_project_not_found';
    end if;
  end if;

  -- Validate before writing anything. Each array member must be exactly the
  -- route's four-field normalized record; permissive jsonb_to_record casts are
  -- intentionally not used until after types, integer range and key ownership
  -- are proven here.
  for v_upload in
    select item
      from jsonb_array_elements(p_uploads) with ordinality as parsed(item, ordinality)
     order by ordinality
  loop
    -- As above, reject a scalar before calling jsonb_object_keys on it.
    if jsonb_typeof(v_upload) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'invalid_upload_completion';
    end if;
    if not (v_upload ?& array['r2_key', 'filename', 'mime', 'byte_size'])
       or (select count(*) from jsonb_object_keys(v_upload)) <> 4 then
      raise exception using errcode = '22023', message = 'invalid_upload_completion';
    end if;
    if jsonb_typeof(v_upload -> 'r2_key') is distinct from 'string'
       or jsonb_typeof(v_upload -> 'filename') is distinct from 'string'
       or jsonb_typeof(v_upload -> 'mime') is distinct from 'string'
       or jsonb_typeof(v_upload -> 'byte_size') is distinct from 'number' then
      raise exception using errcode = '22023', message = 'invalid_upload_completion';
    end if;

    v_r2_key := v_upload ->> 'r2_key';
    v_filename := v_upload ->> 'filename';
    v_mime := v_upload ->> 'mime';
    v_byte_size := (v_upload ->> 'byte_size')::numeric;

    if char_length(v_r2_key) <= char_length(v_prefix)
       or octet_length(v_r2_key) > 1024
       or left(v_r2_key, char_length(v_prefix)) <> v_prefix
       or char_length(v_filename) not between 1 and 512
       or char_length(v_mime) not between 1 and 255
       or v_byte_size <> trunc(v_byte_size)
       or v_byte_size < 1
       or v_byte_size > 100 * 1024 * 1024
       or v_r2_key = any(v_r2_keys) then
      raise exception using errcode = '22023', message = 'invalid_upload_completion';
    end if;

    v_r2_keys := array_append(v_r2_keys, v_r2_key);
    v_asset_ids := array_append(v_asset_ids, gen_random_uuid());
  end loop;

  -- Asset kind classification deliberately mirrors shared
  -- assetKindFromMime(): image/*, exact PDF, the supported document family,
  -- then other. IDs were generated in the validation loop, so array position
  -- is the durable upload-input order independent of INSERT RETURNING order.
  insert into public.assets (id, workspace_id, added_by, kind, title)
  select
    v_asset_ids[parsed.ordinality::integer],
    p_workspace_id,
    v_actor,
    case
      when upload.mime like 'image/%' then 'photo'::public.asset_kind
      when upload.mime = 'application/pdf' then 'pdf'::public.asset_kind
      when upload.mime like 'text/%'
        or upload.mime = 'application/msword'
        or upload.mime like '%wordprocessingml.document'
        or upload.mime = 'application/rtf'
        then 'document'::public.asset_kind
      else 'other'::public.asset_kind
    end,
    upload.filename
  from jsonb_array_elements(p_uploads) with ordinality as parsed(item, ordinality)
  cross join lateral jsonb_to_record(parsed.item) as upload(
    r2_key text,
    filename text,
    mime text,
    byte_size bigint
  );

  insert into public.files (
    asset_id,
    workspace_id,
    origin,
    r2_key,
    mime_type,
    byte_size
  )
  select
    v_asset_ids[parsed.ordinality::integer],
    p_workspace_id,
    'upload'::public.file_origin,
    upload.r2_key,
    upload.mime,
    upload.byte_size
  from jsonb_array_elements(p_uploads) with ordinality as parsed(item, ordinality)
  cross join lateral jsonb_to_record(parsed.item) as upload(
    r2_key text,
    filename text,
    mime text,
    byte_size bigint
  );

  -- Ingest can deduplicate and delete the fresh asset. Put membership in place
  -- before the queued job row exists so the worker can always transfer those
  -- links to the surviving asset inside its own transaction.
  if p_project_id is not null then
    insert into public.project_assets (project_id, asset_id, added_by)
    select p_project_id, requested.asset_id, v_actor
      from unnest(v_asset_ids) with ordinality as requested(asset_id, ordinality)
     order by requested.ordinality;
  end if;

  insert into public.ai_jobs (
    workspace_id,
    user_id,
    type,
    status,
    payload,
    total_items,
    done_items
  ) values (
    p_workspace_id,
    v_actor,
    'ingest'::public.job_type,
    'queued'::public.job_status,
    jsonb_build_object('asset_ids', to_jsonb(v_asset_ids)),
    cardinality(v_asset_ids),
    0
  )
  returning id into v_job_id;

  -- Last write: if this or any earlier/later trigger fails, the entire function
  -- statement rolls back assets, files, links and job along with the ledger.
  insert into public.upload_completions (
    workspace_id,
    completion_id,
    created_by,
    request_payload,
    asset_ids,
    job_id
  ) values (
    p_workspace_id,
    p_completion_id,
    v_actor,
    v_request,
    v_asset_ids,
    v_job_id
  );

  return query select v_asset_ids, v_job_id;
end;
$$;

comment on function public.complete_upload_batch(uuid, uuid, uuid, jsonb) is
  'Atomically creates local-upload assets/files, optional project links and one ingest job. Exact retries replay by workspace/completion id; mismatched reuse raises upload_completion_conflict.';

-- New functions are executable by PUBLIC by default. This function crosses
-- RLS intentionally and therefore exposes only the authenticated role that it
-- checks again with is_editor() internally.
revoke all on function public.complete_upload_batch(uuid, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.complete_upload_batch(uuid, uuid, uuid, jsonb)
  to authenticated;
