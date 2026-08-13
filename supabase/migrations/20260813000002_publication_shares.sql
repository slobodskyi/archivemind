-- Public publication previews — ADR 0046.
--
-- A browser-local content draft (ADR 0045) becomes durable only at the
-- explicit Share boundary. The durable object is an immutable, publishable
-- snapshot: no brief, board/project/workspace id, real asset id or R2 key is
-- present in `snapshot`. Media is addressed by per-publication opaque UUIDs.
--
-- The raw bearer token is NEVER stored. The web hashes its 256-bit token with
-- SHA-256 and passes the 64-character hex digest to these RPCs; only the 32
-- decoded bytes live here. The three resolver RPCs are service-role-only and are
-- called exclusively through the server integration boundary: the Supabase
-- anon key is public and must not be enough to retrieve internal R2 keys.

create table public.publication_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- A publication is a versioned deliverable, not board state. If the source
  -- board is eventually hard-deleted, the already-published snapshot survives.
  board_id uuid references public.boards(id) on delete set null,
  source_draft_id text not null check (
    char_length(btrim(source_draft_id)) between 1 and 200
  ),
  kind text not null check (kind in ('article', 'instagram_carousel')),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and pg_column_size(snapshot) <= 1048576
  ),
  -- Frozen at publication time. Later workspace-credit edits must not silently
  -- rewrite material that may already have been sent to an editor/client.
  rights jsonb not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status text not null default 'preparing'
    check (status in ('preparing', 'ready', 'revoked')),
  allow_downloads boolean not null default true,
  expires_at timestamptz,
  ready_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at),
  check (
    (status = 'preparing' and ready_at is null and revoked_at is null)
    or (status = 'ready' and ready_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create index publication_shares_workspace_draft_idx
  on public.publication_shares (workspace_id, source_draft_id, created_at desc);
create index publication_shares_live_expiry_idx
  on public.publication_shares (expires_at)
  where status = 'ready' and revoked_at is null;

create table public.publication_share_assets (
  share_id uuid not null references public.publication_shares(id) on delete cascade,
  -- SET NULL keeps the share-owned R2 key available for cleanup after a rare
  -- hard asset delete. The asset trigger below revokes the share first.
  asset_id uuid references public.assets(id) on delete set null,
  public_id uuid not null,
  position int not null check (position between 0 and 19),
  filename text not null check (
    char_length(btrim(filename)) between 1 and 500
    and filename !~ '[[:cntrl:]]'
  ),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  -- Retained while `preparing` so a failed copy can be retried. Never returned
  -- by either public resolver.
  source_preview_r2_key text not null,
  -- A share-owned immutable copy under
  -- {workspace}/shares/{share}/previews/{public}.webp.
  preview_r2_key text not null,
  -- Stored originals are referenced (not duplicated). Drive has no stored
  -- original, so web_1024 downloads point at the share-owned preview copy.
  download_r2_key text not null,
  download_filename text not null check (
    char_length(btrim(download_filename)) between 1 and 500
    and download_filename !~ '[[:cntrl:]]'
  ),
  download_mime_type text not null check (
    char_length(btrim(download_mime_type)) between 1 and 200
    and download_mime_type !~ '[[:cntrl:]]'
  ),
  download_quality text not null check (download_quality in ('original', 'web_1024')),
  created_at timestamptz not null default now(),
  primary key (share_id, public_id),
  unique (share_id, position)
);

create unique index publication_share_assets_asset_idx
  on public.publication_share_assets (share_id, asset_id)
  where asset_id is not null;
create index publication_share_assets_asset_lookup_idx
  on public.publication_share_assets (asset_id)
  where asset_id is not null;

create trigger publication_shares_updated_at
  before update on public.publication_shares
  for each row execute function public.set_updated_at();

comment on table public.publication_shares is
  'Immutable public Article/Carousel snapshot. Raw bearer tokens are never stored; the public Next page uses service-role-only hash-gated resolver RPCs (ADR 0046).';
comment on column public.publication_shares.status is
  'preparing while the web copies share-owned previews; ready only after every copy succeeds; revoked is terminal.';
comment on table public.publication_share_assets is
  'Private source-to-public media map for a publication. Public callers receive opaque public_id values and freshly presigned URLs, never real asset ids or R2 keys.';

-- Every domain table has RLS. Neither anon nor authenticated callers receive a
-- direct table grant or policy. Authenticated writes cross editor-gated
-- SECURITY DEFINER functions; public page reads cross service-role-only
-- resolvers behind a fenced server integration module.
alter table public.publication_shares enable row level security;
alter table public.publication_share_assets enable row level security;

revoke all on table public.publication_shares from public, anon, authenticated;
revoke all on table public.publication_share_assets from public, anon, authenticated;
grant all on table public.publication_shares, public.publication_share_assets to service_role;

-- `files` contains binary-custody fields. Cloud imports still insert their
-- source metadata as the authenticated caller (with `r2_key = null`), while
-- local upload completion and the ingest worker fill stored-object custody
-- through trusted SECURITY DEFINER/service connections. Keep that import path,
-- but do not let a browser mutate an existing file or manufacture a stored R2
-- key that a publication route could later sign.
revoke update, delete on table public.files from authenticated;

create function public.guard_authenticated_file_custody()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- `current_user`, rather than auth.role(), deliberately distinguishes a
  -- direct PostgREST table insert from complete_upload_batch: the latter runs
  -- as its SECURITY DEFINER owner even though it carries an authenticated JWT.
  if current_user = 'authenticated' and new.r2_key is not null then
    raise insufficient_privilege using message = 'file_custody_server_required';
  end if;
  return new;
end;
$$;

create trigger files_guard_authenticated_custody
  before insert on public.files
  for each row execute function public.guard_authenticated_file_custody();

-- Reject private editor keys anywhere in the public JSON tree. The Zod route
-- is the primary shape validator; this recursive DB guard prevents a future or
-- direct RPC caller from accidentally making tenant/source identifiers public.
create function public.publication_snapshot_has_private_keys(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  entry record;
begin
  if value is null then
    return false;
  end if;

  if jsonb_typeof(value) = 'object' then
    for entry in select key, val from jsonb_each(value) as item(key, val)
    loop
      if entry.key = any(array[
        'assetId', 'assetIds', 'sourceAssetIds', 'sourceSnapshot',
        'boardId', 'workspaceId', 'projectId', 'brief',
        'version', 'manualEditVersion', 'createdBy',
        'r2Key', 'previewR2Key', 'downloadR2Key',
        'asset_id', 'asset_ids', 'source_asset_ids', 'source_snapshot',
        'board_id', 'workspace_id', 'project_id', 'created_by',
        'r2_key', 'preview_r2_key', 'download_r2_key'
      ]) then
        return true;
      end if;
      if public.publication_snapshot_has_private_keys(entry.val) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for entry in select val from jsonb_array_elements(value) as item(val)
    loop
      if public.publication_snapshot_has_private_keys(entry.val) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

-- Atomically reserve the share/version and its private media map. The caller
-- then executes `copy_plan` against R2 and calls activate_publication_share.
-- A resolver cannot see `preparing`, so a failed or half-finished copy is never
-- a public broken publication.
create function public.create_publication_share(
  p_board_id uuid,
  p_source_draft_id text,
  p_kind text,
  p_name text,
  p_snapshot jsonb,
  p_token_hash text,
  p_expires_at timestamptz,
  p_allow_downloads boolean,
  p_assets jsonb
)
returns table(
  id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  copy_plan jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_project_id uuid;
  v_caller_id uuid := auth.uid();
  v_caller_role text := auth.role();
  v_share_id uuid := gen_random_uuid();
  v_created_at timestamptz;
  v_asset_count int;
  v_valid_asset_count int;
  v_expected_public_ids jsonb;
  v_rights jsonb;
  v_copy_plan jsonb;
begin
  -- service_role is granted for migration/runtime tooling, not to manufacture
  -- an authorless browser share. Creation always represents a real signed-in
  -- person; otherwise is_editor() would be false anyway, but this makes the
  -- boundary explicit before any row/key validation.
  if v_caller_role <> 'authenticated' or v_caller_id is null then
    raise insufficient_privilege using message = 'publication_editor_required';
  end if;
  if p_board_id is null then
    raise exception using errcode = '22023', message = 'invalid_publication_board';
  end if;
  if p_source_draft_id is null
     or char_length(btrim(p_source_draft_id)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_publication_draft';
  end if;
  if p_kind is null or p_kind not in ('article', 'instagram_carousel') then
    raise exception using errcode = '22023', message = 'invalid_publication_kind';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'invalid_publication_name';
  end if;
  if p_snapshot is null
     or jsonb_typeof(p_snapshot) <> 'object'
     or pg_column_size(p_snapshot) > 1048576
     or p_snapshot->>'kind' is distinct from p_kind
     or p_snapshot->>'name' is distinct from btrim(p_name)
     or p_snapshot->>'schemaVersion' is distinct from '1'
     or jsonb_typeof(p_snapshot->'publicAssetIds') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_publication_snapshot';
  end if;
  if public.publication_snapshot_has_private_keys(p_snapshot) then
    raise exception using errcode = '22023', message = 'publication_snapshot_private';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_publication_token_hash';
  end if;
  if p_expires_at is not null
     and (p_expires_at <= now() or p_expires_at > now() + interval '31 days') then
    raise exception using errcode = '22023', message = 'invalid_publication_expiry';
  end if;
  if p_allow_downloads is null then
    raise exception using errcode = '22023', message = 'invalid_publication_downloads';
  end if;
  if p_assets is null
     or jsonb_typeof(p_assets) <> 'array'
     or jsonb_array_length(p_assets) > 20 then
    raise exception using errcode = '22023', message = 'invalid_publication_assets';
  end if;

  select b.workspace_id, b.project_id
    into v_workspace_id, v_project_id
    from public.boards b
    join public.projects p
      on p.id = b.project_id
     and p.workspace_id = b.workspace_id
   where b.id = p_board_id
     and b.deleted_at is null
     and p.deleted_at is null
     and p.archived_at is null
   for update of b;

  if not found or not public.is_editor(v_workspace_id) then
    raise insufficient_privilege using message = 'publication_editor_required';
  end if;

  select count(*)::int
    into v_asset_count
    from jsonb_to_recordset(p_assets) as item(
      "assetId" uuid,
      "publicId" uuid,
      position int,
      filename text,
      width int,
      height int,
      "previewR2Key" text,
      "downloadR2Key" text,
      "downloadFilename" text,
      "downloadMimeType" text,
      "downloadQuality" text
    );

  -- JSON-to-record casts catch malformed UUIDs. These checks make every other
  -- malformed field fail with the route's one stable error code rather than a
  -- later NOT NULL/check/unique violation.
  if exists (
    select 1
      from jsonb_to_recordset(p_assets) as item(
        "assetId" uuid,
        "publicId" uuid,
        position int,
        filename text,
        width int,
        height int,
        "previewR2Key" text,
        "downloadR2Key" text,
        "downloadFilename" text,
        "downloadMimeType" text,
        "downloadQuality" text
      )
     where item."assetId" is null
        or item."publicId" is null
        or item.position is null
        or item.position < 0
        or item.position >= v_asset_count
        or item.filename is null
        or char_length(btrim(item.filename)) not between 1 and 500
        or item.filename ~ '[[:cntrl:]]'
        or item.width is not null and item.width <= 0
        or item.height is not null and item.height <= 0
        or item."previewR2Key" is null
        or char_length(item."previewR2Key") < 1
        or item."downloadFilename" is null
        or char_length(btrim(item."downloadFilename")) not between 1 and 500
        or item."downloadFilename" ~ '[[:cntrl:]]'
        or item."downloadMimeType" is null
        or char_length(btrim(item."downloadMimeType")) not between 1 and 200
        or item."downloadMimeType" ~ '[[:cntrl:]]'
        or item."downloadQuality" not in ('original', 'web_1024')
        or (item."downloadQuality" = 'original' and item."downloadR2Key" is null)
        or (item."downloadQuality" = 'web_1024' and item."downloadR2Key" is not null)
        or (item."downloadQuality" = 'web_1024' and item."downloadMimeType" <> 'image/webp')
  ) then
    raise exception using errcode = '22023', message = 'invalid_publication_assets';
  end if;

  if (
    select count(distinct item."assetId") <> v_asset_count
        or count(distinct item."publicId") <> v_asset_count
        or count(distinct item.position) <> v_asset_count
      from jsonb_to_recordset(p_assets) as item(
        "assetId" uuid,
        "publicId" uuid,
        position int
      )
  ) then
    raise exception using errcode = '22023', message = 'invalid_publication_assets';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item."publicId"::text) order by item.position), '[]'::jsonb)
    into v_expected_public_ids
    from jsonb_to_recordset(p_assets) as item("publicId" uuid, position int);

  if p_snapshot->'publicAssetIds' <> v_expected_public_ids then
    raise exception using errcode = '22023', message = 'publication_asset_map_mismatch';
  end if;

  -- Serialize publication reservation with Trash. Lock in asset-id order so a
  -- concurrent multi-asset publication takes the same order as another one.
  -- The asset-trash trigger locks the asset row before revoking its shares; by
  -- taking the asset locks before inserting the share row, creation can never
  -- commit a `preparing` version for bytes that were concurrently trashed.
  perform a.id
    from jsonb_to_recordset(p_assets) as item("assetId" uuid)
    join public.assets a
      on a.id = item."assetId"
     and a.workspace_id = v_workspace_id
   order by a.id
   for update of a;

  -- Exact membership + exact source keys. An editor may only publish active
  -- assets that still belong to both this board and its project. Preview keys
  -- are derived data owned by that asset; an `original` key must be one of the
  -- same asset's stored files. This prevents the SECURITY DEFINER call from
  -- being turned into a cross-tenant R2 signer.
  select count(*)::int
    into v_valid_asset_count
    from jsonb_to_recordset(p_assets) as item(
      "assetId" uuid,
      "previewR2Key" text,
      "downloadR2Key" text,
      "downloadQuality" text
    )
    join public.board_assets ba
      on ba.board_id = p_board_id and ba.asset_id = item."assetId"
    join public.project_assets pa
      on pa.project_id = v_project_id and pa.asset_id = item."assetId"
    join public.assets a
      on a.id = item."assetId"
     and a.workspace_id = v_workspace_id
     and a.status = 'active'
     and a.purged_at is null
    join public.asset_previews ap
      on ap.asset_id = a.id and ap.size = 'medium'
    left join public.asset_edits ae on ae.asset_id = a.id
   where item."previewR2Key" = coalesce(ae.edited_medium_key, ap.r2_key)
     and (
       item."downloadQuality" = 'web_1024'
       or exists (
         select 1 from public.files f
          where f.asset_id = a.id
            and f.workspace_id = v_workspace_id
            and f.r2_key = item."downloadR2Key"
            and char_length(f.r2_key) > char_length(v_workspace_id::text || '/originals/')
            and left(f.r2_key, char_length(v_workspace_id::text || '/originals/'))
                  = v_workspace_id::text || '/originals/'
       )
     );

  if v_valid_asset_count <> v_asset_count then
    raise no_data_found using message = 'publication_assets_not_found';
  end if;

  select jsonb_build_object(
    'creator', w.creator,
    'credit', w.credit,
    'copyrightNotice', w.copyright_notice,
    'usageTerms', w.usage_terms
  )
    into v_rights
    from public.workspaces w
   where w.id = v_workspace_id;

  insert into public.publication_shares (
    id, workspace_id, board_id, source_draft_id, kind, name, snapshot, rights,
    token_hash, allow_downloads, expires_at, created_by
  ) values (
    v_share_id, v_workspace_id, p_board_id, btrim(p_source_draft_id), p_kind,
    btrim(p_name), p_snapshot, v_rights, decode(lower(p_token_hash), 'hex'),
    p_allow_downloads, p_expires_at, v_caller_id
  )
  returning publication_shares.created_at into v_created_at;

  insert into public.publication_share_assets (
    share_id, asset_id, public_id, position, filename, width, height,
    source_preview_r2_key, preview_r2_key, download_r2_key,
    download_filename, download_mime_type, download_quality
  )
  select
    v_share_id,
    item."assetId",
    item."publicId",
    item.position,
    btrim(item.filename),
    item.width,
    item.height,
    item."previewR2Key",
    v_workspace_id::text || '/shares/' || v_share_id::text || '/previews/' || item."publicId"::text || '.webp',
    case
      when item."downloadQuality" = 'web_1024'
        then v_workspace_id::text || '/shares/' || v_share_id::text || '/previews/' || item."publicId"::text || '.webp'
      else item."downloadR2Key"
    end,
    btrim(item."downloadFilename"),
    btrim(item."downloadMimeType"),
    item."downloadQuality"
  from jsonb_to_recordset(p_assets) as item(
    "assetId" uuid,
    "publicId" uuid,
    position int,
    filename text,
    width int,
    height int,
    "previewR2Key" text,
    "downloadR2Key" text,
    "downloadFilename" text,
    "downloadMimeType" text,
    "downloadQuality" text
  );

  select coalesce(jsonb_agg(jsonb_build_object(
      'publicId', psa.public_id,
      'sourceR2Key', psa.source_preview_r2_key,
      'destinationR2Key', psa.preview_r2_key
    ) order by psa.position), '[]'::jsonb)
    into v_copy_plan
    from public.publication_share_assets psa
   where psa.share_id = v_share_id;

  return query select v_share_id, v_created_at, p_expires_at, v_copy_plan;
end;
$$;

-- Publish only after every object in copy_plan exists. Idempotent retries are
-- allowed; revoked and expired versions can never be reactivated.
create function public.activate_publication_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.publication_shares%rowtype;
begin
  select * into v_share
    from public.publication_shares ps
   where ps.id = p_share_id
   for update;

  if not found then
    raise no_data_found using message = 'publication_share_not_found';
  end if;
  if not public.is_editor(v_share.workspace_id)
     or (v_share.created_by is distinct from auth.uid()
         and not public.is_owner(v_share.workspace_id)) then
    raise insufficient_privilege using message = 'publication_share_owner_required';
  end if;
  if v_share.status = 'revoked'
     or (v_share.expires_at is not null and v_share.expires_at <= now()) then
    return false;
  end if;
  if v_share.status = 'ready' then
    return true;
  end if;

  update public.publication_shares ps
     set status = 'ready', ready_at = now()
   where ps.id = p_share_id and ps.status = 'preparing';
  return found;
end;
$$;

-- Revocation is terminal. Return share-owned preview keys so the authenticated
-- route can best-effort delete them from R2; calling again returns the same plan
-- and is therefore safe after a partial cleanup failure.
create function public.revoke_publication_share(p_share_id uuid)
returns table(id uuid, preview_r2_keys jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.publication_shares%rowtype;
  v_keys jsonb;
begin
  select * into v_share
    from public.publication_shares ps
   where ps.id = p_share_id
   for update;

  if not found then
    raise no_data_found using message = 'publication_share_not_found';
  end if;
  if not public.is_editor(v_share.workspace_id)
     or (v_share.created_by is distinct from auth.uid()
         and not public.is_owner(v_share.workspace_id)) then
    raise insufficient_privilege using message = 'publication_share_owner_required';
  end if;

  update public.publication_shares ps
     set status = 'revoked',
         ready_at = null,
         revoked_at = coalesce(ps.revoked_at, now())
   where ps.id = p_share_id;

  select coalesce(jsonb_agg(psa.preview_r2_key order by psa.position), '[]'::jsonb)
    into v_keys
    from public.publication_share_assets psa
   where psa.share_id = p_share_id;

  return query select p_share_id, v_keys;
end;
$$;

-- Authoring-side link management. The raw token is unrecoverable by design, so
-- an author who lost their browser state would otherwise have a live link they
-- cannot even switch off. This returns status only — never a token digest, an
-- R2 key or a snapshot — so knowing that a version is live is not the same
-- capability as being able to read it.
-- Scoped to the BOARD, not to one draft id: a draft lives in localStorage, so
-- the browser asking the question may no longer hold the draft whose link is
-- still serving. The row carries its `source_draft_id` and the client groups by
-- it; a version whose draft is gone stays visible instead of becoming
-- unreachable. Expired versions are returned too — `status` stays 'ready' past
-- the deadline on purpose (retention and audit read it), so expiry is derived
-- from `expires_at` by the caller rather than hidden here.
create function public.list_publication_shares(p_board_id uuid)
returns table(
  id uuid,
  source_draft_id text,
  kind text,
  name text,
  status text,
  allow_downloads boolean,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  if p_board_id is null then
    return;
  end if;

  -- A trashed board still lists: turning a delivered link off must not depend
  -- on the temporary source scope still being open.
  select b.workspace_id into v_workspace_id
    from public.boards b
   where b.id = p_board_id;

  if not found or not public.is_editor(v_workspace_id) then
    raise insufficient_privilege using message = 'publication_editor_required';
  end if;

  return query
  select
    ps.id,
    ps.source_draft_id,
    ps.kind,
    ps.name,
    ps.status,
    ps.allow_downloads,
    ps.created_at,
    ps.expires_at
  from public.publication_shares ps
  where ps.workspace_id = v_workspace_id
    and ps.board_id = p_board_id
    and ps.status <> 'revoked'
  order by ps.created_at desc;
end;
$$;

-- Server-only snapshot resolver. It returns only publishable JSON and opaque
-- public media ids. Real asset ids, source keys and download keys stay private,
-- and so does the preview key: images are fetched through their own per-request
-- resolver below, so a page rendered once cannot hold a signature that outlives
-- the link.
create function public.resolve_publication_share(p_token_hash text)
returns table(
  id uuid,
  kind text,
  name text,
  snapshot jsonb,
  rights jsonb,
  allow_downloads boolean,
  created_at timestamptz,
  expires_at timestamptz,
  assets jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9A-Fa-f]{64}$' then
    return;
  end if;

  return query
  select
    ps.id,
    ps.kind,
    ps.name,
    ps.snapshot,
    ps.rights,
    ps.allow_downloads,
    ps.created_at,
    ps.expires_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'publicId', psa.public_id,
        'position', psa.position,
        'filename', psa.filename,
        'width', psa.width,
        'height', psa.height,
        'downloadFilename', psa.download_filename,
        'downloadMimeType', psa.download_mime_type,
        'downloadQuality', psa.download_quality
      ) order by psa.position)
      from public.publication_share_assets psa
      where psa.share_id = ps.id
    ), '[]'::jsonb)
  from public.publication_shares ps
  where ps.token_hash = decode(lower(p_token_hash), 'hex')
    and ps.status = 'ready'
    and ps.revoked_at is null
    and (ps.expires_at is null or ps.expires_at > now());
end;
$$;

-- Server-only preview capability, resolved once per image request rather than
-- once per page render. A long article lazy-loads images minutes after its HTML
-- was produced, so a signature minted at render time would either have to
-- outlive the short revocation window or expire below the fold. Deliberately
-- NOT gated on allow_downloads: a publication must render its own pictures even
-- when the recipient may not take the files away.
create function public.resolve_publication_share_preview(
  p_token_hash text,
  p_public_id uuid
)
returns table(
  share_id uuid,
  public_id uuid,
  preview_r2_key text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9A-Fa-f]{64}$'
     or p_public_id is null then
    return;
  end if;

  return query
  select
    ps.id,
    psa.public_id,
    psa.preview_r2_key
  from public.publication_shares ps
  join public.publication_share_assets psa on psa.share_id = ps.id
  where ps.token_hash = decode(lower(p_token_hash), 'hex')
    and psa.public_id = p_public_id
    and ps.status = 'ready'
    and ps.revoked_at is null
    and (ps.expires_at is null or ps.expires_at > now());
end;
$$;

-- Separate server-only download capability: neither the snapshot nor the
-- preview resolver returns this key.
-- `allow_downloads=false`, invalid, expired and revoked all produce zero rows.
create function public.resolve_publication_share_asset(
  p_token_hash text,
  p_public_id uuid
)
returns table(
  share_id uuid,
  public_id uuid,
  download_r2_key text,
  download_filename text,
  download_mime_type text,
  download_quality text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9A-Fa-f]{64}$'
     or p_public_id is null then
    return;
  end if;

  return query
  select
    ps.id,
    psa.public_id,
    psa.download_r2_key,
    psa.download_filename,
    psa.download_mime_type,
    psa.download_quality
  from public.publication_shares ps
  join public.publication_share_assets psa on psa.share_id = ps.id
  where ps.token_hash = decode(lower(p_token_hash), 'hex')
    and psa.public_id = p_public_id
    and ps.status = 'ready'
    and ps.revoked_at is null
    and ps.allow_downloads
    and (ps.expires_at is null or ps.expires_at > now());
end;
$$;

-- Deleting/trashing an asset must kill every public bearer capability that can
-- render or download it. This is deliberately a DB trigger so every status
-- writer (web, worker, future admin tool) follows the same privacy rule.
create function public.revoke_publication_shares_for_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_id uuid;
begin
  if tg_op = 'DELETE' then
    v_asset_id := old.id;
  elsif new.status = 'deleted'
        and (old.status is distinct from 'deleted'
             or old.purged_at is distinct from new.purged_at) then
    v_asset_id := new.id;
  else
    return new;
  end if;

  update public.publication_shares ps
     set status = 'revoked',
         ready_at = null,
         revoked_at = coalesce(ps.revoked_at, now())
   where ps.status <> 'revoked'
     and exists (
       select 1 from public.publication_share_assets psa
        where psa.share_id = ps.id and psa.asset_id = v_asset_id
     );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger assets_revoke_publication_shares
  before update of status, purged_at or delete on public.assets
  for each row execute function public.revoke_publication_shares_for_asset();

-- Functions are EXECUTE-able by PUBLIC by default. Keep the actual capability
-- surface explicit: editors create/manage; the fenced Next integration invokes
-- the resolvers as service_role. A browser knows the Supabase anon key, so anon
-- MUST NOT be able to bypass our response projection and receive internal R2
-- keys or tenant UUIDs. Internal recursive/trigger functions are not an API.
revoke all on function public.publication_snapshot_has_private_keys(jsonb)
  from public, anon, authenticated;
revoke all on function public.create_publication_share(uuid, text, text, text, jsonb, text, timestamptz, boolean, jsonb)
  from public, anon;
revoke all on function public.activate_publication_share(uuid)
  from public, anon;
revoke all on function public.revoke_publication_share(uuid)
  from public, anon;
revoke all on function public.list_publication_shares(uuid)
  from public, anon;
revoke all on function public.resolve_publication_share(text)
  from public, anon, authenticated;
revoke all on function public.resolve_publication_share_preview(text, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_publication_share_asset(text, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_publication_shares_for_asset()
  from public, anon, authenticated;

grant execute on function public.create_publication_share(uuid, text, text, text, jsonb, text, timestamptz, boolean, jsonb)
  to authenticated, service_role;
grant execute on function public.activate_publication_share(uuid)
  to authenticated, service_role;
grant execute on function public.revoke_publication_share(uuid)
  to authenticated, service_role;
grant execute on function public.list_publication_shares(uuid)
  to authenticated, service_role;
grant execute on function public.resolve_publication_share(text)
  to service_role;
grant execute on function public.resolve_publication_share_preview(text, uuid)
  to service_role;
grant execute on function public.resolve_publication_share_asset(text, uuid)
  to service_role;

comment on function public.create_publication_share(uuid, text, text, text, jsonb, text, timestamptz, boolean, jsonb) is
  'Editor-only atomic publication reservation. Returns an R2 copy plan; call activate_publication_share only after every preview copy succeeds (ADR 0046).';
comment on function public.list_publication_shares(uuid) is
  'Editor-only status list for a board''s unrevoked publications, carrying source_draft_id so the client can group them. Returns no token digest, R2 key or snapshot: it exists so a link whose URL was lost with the browser can still be turned off (ADR 0046).';
comment on function public.resolve_publication_share(text) is
  'Service-role-only hash-gated safe projection for the server-rendered /p/:token page. Invalid, preparing, expired and revoked shares all return zero rows.';
comment on function public.resolve_publication_share_preview(text, uuid) is
  'Service-role-only hash-gated preview lookup, re-validated per image request so a lazily loaded picture never depends on a signature minted at page render. Not gated on allow_downloads: rendering a publication is not taking its files.';
comment on function public.resolve_publication_share_asset(text, uuid) is
  'Service-role-only hash-gated download lookup. Returns one private key only when the publication is live and downloads are enabled; the web presigns it per request.';
