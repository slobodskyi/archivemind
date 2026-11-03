-- Project share links — ADR 0051.
--
-- A project share is a bearer capability over ONE project, minted by an editor
-- for somebody with no account. Each link carries its own rights: browse and
-- download, upload (a file request that reveals nothing of the project), or
-- both.
--
-- Unlike a publication (ADR 0046) a project share is a LIVE window, not a
-- snapshot. Nothing is copied when the link is made; every request re-resolves
-- the project's current files, so a photo moved to Trash leaves the link with
-- the very next request.
--
-- Token custody follows ADR 0046 with one addition. A link is looked up by the
-- SHA-256 digest of its 256-bit token only; `token_ciphertext` additionally
-- keeps an AES-GCM copy (TOKEN_ENC_KEY, packages/shared token-crypto) so an
-- editor can copy a live link again from any device. A database read alone
-- still yields no working link. ADR 0046 deferred exactly this "vault" as a
-- separate feature; it is scoped to this table.
--
-- Access: RLS on and no anon/authenticated table privilege. Editors manage
-- links through SECURITY DEFINER RPCs that check is_editor(); the public
-- /s/:token surface reaches data only through service-role-only resolvers
-- called by the fenced Next integration (lib/integrations/project-shares.server.ts).

create table public.project_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- For the people who manage the link ("Reuters desk"). Never shown to the
  -- recipient, who sees the project name and the workspace byline.
  label text check (
    label is null
    or (char_length(btrim(label)) between 1 and 80 and label !~ '[[:cntrl:]]')
  ),
  can_download boolean not null,
  can_upload boolean not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  -- `v1:iv:ct:tag` from encryptToken(). Null when the server had no key at
  -- creation: the link still works, it just cannot be copied again.
  token_ciphertext text check (
    token_ciphertext is null or char_length(token_ciphertext) between 1 and 512
  ),
  -- Always set: a live window into a project must not stay open because a link
  -- was forgotten. Create/extend accept 1, 7, 30 or 90 days only.
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- Upload quota per link, stored per row so it can be tuned without a
  -- migration. Counts every reservation that is not rejected or expired.
  max_files int not null default 2000 check (max_files between 1 and 100000),
  max_bytes bigint not null default 21474836480 check (max_bytes between 1 and 1099511627776),
  download_count int not null default 0 check (download_count >= 0),
  last_opened_at timestamptz,
  last_upload_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (can_download or can_upload),
  check (expires_at > created_at)
);

create index project_shares_project_idx
  on public.project_shares (project_id, created_at desc);
create index project_shares_live_idx
  on public.project_shares (workspace_id, project_id)
  where revoked_at is null;

create trigger project_shares_updated_at
  before update on public.project_shares
  for each row execute function public.set_updated_at();

-- One row per file somebody asked to send through a link. The browser PUTs to
-- `staging_key` only; completion copies the object to `final_key` server-side
-- and verifies its size there. A presigned PUT stays valid for 15 minutes, so a
-- browser-writable final key would let an anonymous sender swap the original
-- after ingest had already previewed and hashed it.
create table public.project_share_uploads (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.project_shares(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  filename text not null check (
    char_length(filename) between 1 and 255
    and filename !~ '[[:cntrl:]/\\]'
  ),
  mime text not null check (char_length(mime) between 1 and 255 and mime !~ '[[:cntrl:]]'),
  declared_bytes bigint not null check (declared_bytes between 1 and 104857600),
  actual_bytes bigint check (actual_bytes is null or actual_bytes >= 0),
  -- {workspace}/incoming/{id}: tenant-prefixed like every other object.
  staging_key text not null unique,
  -- {workspace}/originals/{id}/{name}: the §6 original layout, deterministic per
  -- reservation so a retried completion rewrites one object, never two.
  final_key text not null unique,
  status text not null default 'reserved'
    check (status in ('reserved', 'finalizing', 'completed', 'rejected', 'expired')),
  claimed_at timestamptz,
  completed_at timestamptz,
  -- Repointed by ingest when a dedup merge keeps an older asset instead.
  asset_id uuid references public.assets(id) on delete set null,
  uploader_name text check (
    uploader_name is null
    or (char_length(btrim(uploader_name)) between 1 and 80 and uploader_name !~ '[[:cntrl:]]')
  ),
  -- Set once the worker has deleted whatever objects this row no longer needs.
  swept_at timestamptz,
  created_at timestamptz not null default now()
);

create index project_share_uploads_share_idx
  on public.project_share_uploads (share_id, status);
create index project_share_uploads_sweep_idx
  on public.project_share_uploads (created_at)
  where swept_at is null;

-- Provenance on the asset itself, so the drawer can say where a file came from
-- without joining the reservation ledger. `added_by` stays null: no workspace
-- member added the file.
alter table public.assets
  add column received_share_id uuid references public.project_shares(id) on delete set null,
  add column received_from text check (
    received_from is null
    or (char_length(btrim(received_from)) between 1 and 80 and received_from !~ '[[:cntrl:]]')
  );

create index assets_received_share_idx
  on public.assets (received_share_id)
  where received_share_id is not null;

comment on table public.project_shares is
  'Live bearer link over one project (ADR 0051). Looked up by token SHA-256; token_ciphertext lets editors copy it again. No anon/authenticated table access.';
comment on table public.project_share_uploads is
  'Reservation ledger for files sent through a project share: quota, staging → final copy, and idempotent completion (ADR 0051).';
comment on column public.assets.received_share_id is
  'Project share this asset arrived through (ADR 0051); null for everything a member added.';

alter table public.project_shares enable row level security;
alter table public.project_share_uploads enable row level security;

revoke all on table public.project_shares from public, anon, authenticated;
revoke all on table public.project_share_uploads from public, anon, authenticated;
grant all on table public.project_shares, public.project_share_uploads to service_role;

-- Mirrors shared assetKindFromMime() and the classification inside
-- complete_upload_batch.
create function public.asset_kind_from_mime(p_mime text)
returns public.asset_kind
language sql
immutable
set search_path = public
as $$
  select case
    when p_mime like 'image/%' then 'photo'::public.asset_kind
    when p_mime = 'application/pdf' then 'pdf'::public.asset_kind
    when p_mime like 'text/%'
      or p_mime = 'application/msword'
      or p_mime like '%wordprocessingml.document'
      or p_mime = 'application/rtf'
      then 'document'::public.asset_kind
    else 'other'::public.asset_kind
  end;
$$;

-- The one definition of a live link. A link works only while it is not turned
-- off, not past its deadline, its project is not in Trash, and the person who
-- made it is still an owner or editor of the workspace: removing a member must
-- not leave their links serving. Archiving a project is organisation, not
-- access control, so it does not stop a link.
create function public.project_share_by_token(p_token_hash text)
returns public.project_shares
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9A-Fa-f]{64}$' then
    return null;
  end if;

  select ps.* into v_share
    from public.project_shares ps
    join public.projects p
      on p.id = ps.project_id
     and p.workspace_id = ps.workspace_id
    join public.memberships m
      on m.workspace_id = ps.workspace_id
     and m.user_id = ps.created_by
     and m.role in ('owner', 'editor')
   where ps.token_hash = decode(lower(p_token_hash), 'hex')
     and ps.revoked_at is null
     and ps.expires_at > now()
     and p.deleted_at is null;

  if not found then
    return null;
  end if;
  return v_share;
end;
$$;

-- ── editor-side management ─────────────────────────────────────────────

create function public.create_project_share(
  p_project_id uuid,
  p_can_download boolean,
  p_can_upload boolean,
  p_expires_in_days int,
  p_label text,
  p_token_hash text,
  p_token_ciphertext text
)
returns table(id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_live int;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise insufficient_privilege using message = 'project_share_editor_required';
  end if;

  select p.workspace_id into v_workspace_id
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null
   for key share;

  if not found or not public.is_editor(v_workspace_id) then
    raise insufficient_privilege using message = 'project_share_editor_required';
  end if;
  if p_can_download is null or p_can_upload is null
     or not (p_can_download or p_can_upload) then
    raise exception using errcode = '22023', message = 'invalid_project_share_rights';
  end if;
  if p_expires_in_days is null or p_expires_in_days not in (1, 7, 30, 90) then
    raise exception using errcode = '22023', message = 'invalid_project_share_expiry';
  end if;
  if v_label is not null
     and (char_length(v_label) > 80 or v_label ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'invalid_project_share_label';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_project_share_token_hash';
  end if;
  if p_token_ciphertext is not null
     and char_length(p_token_ciphertext) not between 1 and 512 then
    raise exception using errcode = '22023', message = 'invalid_project_share_token';
  end if;

  -- A bound on open windows per project, so a stuck client cannot mint links
  -- without end. Expired links do not count; they can be extended or ignored.
  select count(*)::int into v_live
    from public.project_shares ps
   where ps.project_id = p_project_id
     and ps.revoked_at is null
     and ps.expires_at > now();
  if v_live >= 25 then
    raise exception using errcode = '53400', message = 'project_share_limit';
  end if;

  return query
  insert into public.project_shares as ps (
    workspace_id, project_id, label, can_download, can_upload,
    token_hash, token_ciphertext, expires_at, created_by
  ) values (
    v_workspace_id, p_project_id, v_label, p_can_download, p_can_upload,
    decode(lower(p_token_hash), 'hex'), p_token_ciphertext,
    now() + make_interval(days => p_expires_in_days), auth.uid()
  )
  returning ps.id, ps.created_at, ps.expires_at;
end;
$$;

-- Every unrevoked link of a project with its status and counters. The
-- ciphertext is returned for live links only, so the editor's route can turn it
-- back into a URL; the digest never leaves the table.
create function public.list_project_shares(p_project_id uuid)
returns table(
  id uuid,
  label text,
  can_download boolean,
  can_upload boolean,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  created_by uuid,
  created_by_name text,
  token_ciphertext text,
  download_count int,
  last_opened_at timestamptz,
  last_upload_at timestamptz,
  files_received int,
  bytes_received bigint,
  max_files int,
  max_bytes bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_project_deleted timestamptz;
begin
  select p.workspace_id, p.deleted_at into v_workspace_id, v_project_deleted
    from public.projects p
   where p.id = p_project_id;

  if not found or not public.is_editor(v_workspace_id) then
    raise insufficient_privilege using message = 'project_share_editor_required';
  end if;

  return query
  with shares as (
    select
      ps.*,
      case
        when ps.expires_at <= now() then 'expired'
        when v_project_deleted is not null
          or not exists (
            select 1 from public.memberships m
             where m.workspace_id = ps.workspace_id
               and m.user_id = ps.created_by
               and m.role in ('owner', 'editor')
          ) then 'inactive'
        else 'live'
      end as link_status
    from public.project_shares ps
    where ps.project_id = p_project_id
      and ps.workspace_id = v_workspace_id
      and ps.revoked_at is null
  )
  select
    s.id,
    s.label,
    s.can_download,
    s.can_upload,
    s.link_status,
    s.created_at,
    s.expires_at,
    s.created_by,
    pr.display_name,
    case when s.link_status = 'live' then s.token_ciphertext end,
    s.download_count,
    s.last_opened_at,
    s.last_upload_at,
    coalesce(u.files, 0)::int,
    coalesce(u.bytes, 0)::bigint,
    s.max_files,
    s.max_bytes
  from shares s
  left join public.profiles pr on pr.id = s.created_by
  left join lateral (
    select count(*) as files, sum(psu.actual_bytes) as bytes
      from public.project_share_uploads psu
     where psu.share_id = s.id
       and psu.status = 'completed'
  ) u on true
  order by s.created_at desc;
end;
$$;

-- Extending widens exposure, so only the person who made the link or a
-- workspace owner may do it. The URL does not change.
create function public.extend_project_share(p_share_id uuid, p_expires_in_days int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype;
  v_expires timestamptz;
begin
  select * into v_share
    from public.project_shares ps
   where ps.id = p_share_id
   for update;

  if not found
     or not public.is_editor(v_share.workspace_id)
     or (v_share.created_by is distinct from auth.uid()
         and not public.is_owner(v_share.workspace_id)) then
    raise insufficient_privilege using message = 'project_share_owner_required';
  end if;
  if v_share.revoked_at is not null then
    raise exception using errcode = '22023', message = 'project_share_revoked';
  end if;
  if p_expires_in_days is null or p_expires_in_days not in (1, 7, 30, 90) then
    raise exception using errcode = '22023', message = 'invalid_project_share_expiry';
  end if;

  update public.project_shares ps
     set expires_at = now() + make_interval(days => p_expires_in_days)
   where ps.id = p_share_id
  returning ps.expires_at into v_expires;
  return v_expires;
end;
$$;

create function public.rename_project_share(p_share_id uuid, p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  select ps.workspace_id into v_workspace_id
    from public.project_shares ps
   where ps.id = p_share_id
   for update;

  if not found or not public.is_editor(v_workspace_id) then
    raise insufficient_privilege using message = 'project_share_editor_required';
  end if;
  if v_label is not null
     and (char_length(v_label) > 80 or v_label ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'invalid_project_share_label';
  end if;

  update public.project_shares ps set label = v_label where ps.id = p_share_id;
  return v_label;
end;
$$;

-- Turning a link off narrows exposure, so any editor may do it, and it is
-- terminal: the digest stays so the same capability can never come back.
create function public.revoke_project_share(p_share_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_revoked timestamptz;
begin
  select ps.workspace_id into v_workspace_id
    from public.project_shares ps
   where ps.id = p_share_id
   for update;

  if not found or not public.is_editor(v_workspace_id) then
    raise insufficient_privilege using message = 'project_share_editor_required';
  end if;

  update public.project_shares ps
     set revoked_at = coalesce(ps.revoked_at, now())
   where ps.id = p_share_id
  returning ps.revoked_at into v_revoked;
  return v_revoked;
end;
$$;

-- Live-link count per project the caller can see, for the marker on the
-- homepage card: a project reachable from outside should never look like one
-- that is not. Scoped to the caller's own memberships, so every card reader
-- can ask without first resolving a workspace id.
create function public.list_project_share_counts()
returns table(project_id uuid, live_count int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise insufficient_privilege using message = 'project_share_member_required';
  end if;

  return query
  select ps.project_id, count(*)::int
    from public.project_shares ps
    join public.memberships caller
      on caller.workspace_id = ps.workspace_id
     and caller.user_id = auth.uid()
    join public.projects p
      on p.id = ps.project_id
     and p.deleted_at is null
    join public.memberships m
      on m.workspace_id = ps.workspace_id
     and m.user_id = ps.created_by
     and m.role in ('owner', 'editor')
   where ps.revoked_at is null
     and ps.expires_at > now()
   group by ps.project_id;
end;
$$;

-- What arrived through one link and is still in its project, for "Show on
-- canvas". Revoked links answer too: turning a link off does not undo what
-- was already received.
create function public.list_project_share_received(p_share_id uuid)
returns table(asset_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype;
begin
  select * into v_share from public.project_shares ps where ps.id = p_share_id;
  if not found or not public.is_editor(v_share.workspace_id) then
    raise insufficient_privilege using message = 'project_share_editor_required';
  end if;

  return query
  select distinct psu.asset_id
    from public.project_share_uploads psu
    join public.assets a
      on a.id = psu.asset_id
     and a.workspace_id = v_share.workspace_id
     and a.status = 'active'
    join public.project_assets pa
      on pa.asset_id = a.id
     and pa.project_id = v_share.project_id
   where psu.share_id = p_share_id
     and psu.status = 'completed';
end;
$$;

-- ── public surface: service_role only ──────────────────────────────────
-- Every resolver re-runs project_share_by_token(), so turning a link off, its
-- deadline, its project's Trash and its author's role all take effect on the
-- next request. Every failure is zero rows; the route maps each to one 404.

-- The page itself. Volatile only to stamp last_opened_at, at most once a minute.
-- An upload-only link learns nothing about the project beyond its name and the
-- workspace byline: no file count.
create function public.open_project_share(p_token_hash text)
returns table(
  share_id uuid,
  project_name text,
  can_download boolean,
  can_upload boolean,
  expires_at timestamptz,
  rights jsonb,
  file_count int,
  max_files int,
  max_bytes bigint,
  used_files int,
  used_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype := public.project_share_by_token(p_token_hash);
begin
  if v_share.id is null then
    return;
  end if;

  update public.project_shares ps
     set last_opened_at = now()
   where ps.id = v_share.id
     and (ps.last_opened_at is null or ps.last_opened_at < now() - interval '1 minute');

  return query
  select
    v_share.id,
    p.name,
    v_share.can_download,
    v_share.can_upload,
    v_share.expires_at,
    jsonb_build_object(
      'creator', w.creator,
      'credit', w.credit,
      'copyrightNotice', w.copyright_notice,
      'usageTerms', w.usage_terms
    ),
    case when v_share.can_download then (
      select count(*)::int
        from public.project_assets pa
        join public.assets a
          on a.id = pa.asset_id
         and a.workspace_id = v_share.workspace_id
         and a.status = 'active'
       where pa.project_id = v_share.project_id
    ) end,
    case when v_share.can_upload then v_share.max_files end,
    case when v_share.can_upload then v_share.max_bytes end,
    case when v_share.can_upload then coalesce(q.files, 0)::int end,
    case when v_share.can_upload then coalesce(q.bytes, 0)::bigint end
  from public.projects p
  join public.workspaces w on w.id = p.workspace_id
  left join lateral (
    select count(*) as files, sum(coalesce(psu.actual_bytes, psu.declared_bytes)) as bytes
      from public.project_share_uploads psu
     where psu.share_id = v_share.id
       and psu.status in ('reserved', 'finalizing', 'completed')
  ) q on true
  where p.id = v_share.project_id;
end;
$$;

-- One page of the project's live files, newest capture first, keyset-paged by
-- (sort_at, id). A deliberately small projection: no tags, captions, facts,
-- labels, location, notes or member names cross this line.
create function public.list_project_share_assets(
  p_token_hash text,
  p_before_sort_at timestamptz,
  p_before_id uuid,
  p_limit int
)
returns table(
  id uuid,
  kind text,
  filename text,
  byte_size bigint,
  width int,
  height int,
  taken_at timestamptz,
  has_preview boolean,
  has_original boolean,
  sort_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype := public.project_share_by_token(p_token_hash);
begin
  if v_share.id is null or not v_share.can_download then
    return;
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_project_share_page';
  end if;

  return query
  select
    a.id,
    a.kind::text,
    coalesce(nullif(btrim(a.title), ''), 'file'),
    orig.byte_size,
    coalesce(med.width, th.width),
    coalesce(med.height, th.height),
    ex.taken_at,
    (th.r2_key is not null or med.r2_key is not null
      or ed.edited_thumb_key is not null or ed.edited_medium_key is not null),
    orig.r2_key is not null,
    coalesce(ex.taken_at, a.created_at) as sort_at
  from public.project_assets pa
  join public.assets a
    on a.id = pa.asset_id
   and a.workspace_id = v_share.workspace_id
   and a.status = 'active'
  left join public.asset_exif ex on ex.asset_id = a.id
  left join public.asset_previews th on th.asset_id = a.id and th.size = 'thumb'
  left join public.asset_previews med on med.asset_id = a.id and med.size = 'medium'
  left join public.asset_edits ed on ed.asset_id = a.id
  left join lateral (
    select f.r2_key, f.byte_size
      from public.files f
     where f.asset_id = a.id
       and f.r2_key is not null
     order by f.created_at
     limit 1
  ) orig on true
  where pa.project_id = v_share.project_id
    and (
      p_before_sort_at is null
      or (coalesce(ex.taken_at, a.created_at), a.id) < (p_before_sort_at, p_before_id)
    )
  order by coalesce(ex.taken_at, a.created_at) desc, a.id desc
  limit p_limit;
end;
$$;

-- One object key for one request: a preview variant, or the file itself. The
-- route exchanges it for a short presigned URL, so no signature outlives the
-- request that asked for it. Without a stored original (Drive, OneDrive) the
-- download is honestly the 1024px web preview, labelled 'web'. Every key must
-- sit under the share's own workspace prefix: a project share signs objects for
-- an anonymous reader, so tenant ownership is checked structurally here rather
-- than trusted from a row.
create function public.resolve_project_share_media(
  p_token_hash text,
  p_asset_id uuid,
  p_variant text
)
returns table(r2_key text, filename text, mime_type text, quality text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype := public.project_share_by_token(p_token_hash);
  v_title text;
  v_thumb text;
  v_medium text;
  v_original text;
  v_mime text;
  v_prefix text;
  v_key text;
begin
  if v_share.id is null
     or not v_share.can_download
     or p_asset_id is null
     or p_variant is null
     or p_variant not in ('thumb', 'medium', 'original') then
    return;
  end if;

  select
    coalesce(nullif(btrim(a.title), ''), 'file'),
    coalesce(ed.edited_thumb_key, th.r2_key, ed.edited_medium_key, med.r2_key),
    coalesce(ed.edited_medium_key, med.r2_key, ed.edited_thumb_key, th.r2_key),
    orig.r2_key,
    orig.mime_type
    into v_title, v_thumb, v_medium, v_original, v_mime
    from public.project_assets pa
    join public.assets a
      on a.id = pa.asset_id
     and a.workspace_id = v_share.workspace_id
     and a.status = 'active'
    left join public.asset_previews th on th.asset_id = a.id and th.size = 'thumb'
    left join public.asset_previews med on med.asset_id = a.id and med.size = 'medium'
    left join public.asset_edits ed on ed.asset_id = a.id
    left join lateral (
      select f.r2_key, f.mime_type
        from public.files f
       where f.asset_id = a.id
         and f.r2_key is not null
       order by f.created_at
       limit 1
    ) orig on true
   where pa.project_id = v_share.project_id
     and pa.asset_id = p_asset_id;

  if not found then
    return;
  end if;

  v_prefix := v_share.workspace_id::text || '/';

  if p_variant = 'original' then
    if v_original is not null then
      if left(v_original, char_length(v_prefix || 'originals/')) <> v_prefix || 'originals/' then
        return;
      end if;
      update public.project_shares ps
         set download_count = ps.download_count + 1
       where ps.id = v_share.id;
      return query select v_original, v_title,
        coalesce(nullif(v_mime, ''), 'application/octet-stream'), 'original'::text;
      return;
    end if;
    v_key := v_medium;
    if v_key is null or left(v_key, char_length(v_prefix)) <> v_prefix then
      return;
    end if;
    update public.project_shares ps
       set download_count = ps.download_count + 1
     where ps.id = v_share.id;
    return query select v_key,
      regexp_replace(v_title, '\.[^./\\]{1,8}$', '') || '.webp',
      'image/webp'::text, 'web'::text;
    return;
  end if;

  v_key := case when p_variant = 'thumb' then v_thumb else v_medium end;
  if v_key is null or left(v_key, char_length(v_prefix)) <> v_prefix then
    return;
  end if;
  return query select v_key, v_title, 'image/webp'::text, 'preview'::text;
end;
$$;

-- Queue a ZIP of the project's files for the recipient, through the ordinary
-- export job. The route builds the payload with the shared zod contract; this
-- function decides which ids it may carry (the requested ones that are live in
-- this project, in the requested order) and stamps share_id. It never sets
-- ai_jobs.project_id: that FK has no delete action.
--
-- Guards, so a stranger cannot crowd out the owner's own exports or run the
-- worker in a loop: one export in flight per link, twenty a day per link, two
-- link exports in flight per workspace — and an identical request whose ZIP
-- still exists is answered with that job instead of a new one.
create function public.enqueue_project_share_download(p_token_hash text, p_payload jsonb)
returns table(job_id uuid, reused boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype := public.project_share_by_token(p_token_hash);
  v_ids uuid[];
  v_job_id uuid;
  v_payload jsonb;
begin
  if v_share.id is null or not v_share.can_download then
    return;
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload -> 'asset_ids') is distinct from 'array'
     or jsonb_typeof(p_payload -> 'options') is distinct from 'object'
     or p_payload -> 'options' ->> 'format' is distinct from 'zip' then
    raise exception using errcode = '22023', message = 'invalid_project_share_download';
  end if;
  if jsonb_array_length(p_payload -> 'asset_ids') not between 1 and 500 then
    raise exception using errcode = '22023', message = 'invalid_project_share_download';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('project-share-export:' || v_share.workspace_id::text, 0)
  );
  perform 1 from public.project_shares ps where ps.id = v_share.id for update;

  select array_agg(requested.asset_id order by requested.first_position)
    into v_ids
    from (
      select item.value::uuid as asset_id, min(item.ordinality) as first_position
        from jsonb_array_elements_text(p_payload -> 'asset_ids') with ordinality as item(value, ordinality)
       where item.value ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
       group by item.value::uuid
    ) requested
    join public.project_assets pa
      on pa.asset_id = requested.asset_id
     and pa.project_id = v_share.project_id
    join public.assets a
      on a.id = requested.asset_id
     and a.workspace_id = v_share.workspace_id
     and a.status = 'active';

  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception using errcode = '22023', message = 'project_share_download_empty';
  end if;

  v_payload := (p_payload - 'result_key' - 'group_id')
    || jsonb_build_object('asset_ids', to_jsonb(v_ids), 'share_id', v_share.id);

  select j.id into v_job_id
    from public.ai_jobs j
   where j.workspace_id = v_share.workspace_id
     and j.type = 'export'
     and j.status = 'done'
     and j.payload ->> 'share_id' = v_share.id::text
     and j.payload ->> 'result_key' is not null
     and j.payload -> 'asset_ids' = v_payload -> 'asset_ids'
     and j.payload -> 'options' = v_payload -> 'options'
     and j.finished_at > now() - interval '7 days'
   order by j.finished_at desc
   limit 1;
  if found then
    return query select v_job_id, true;
    return;
  end if;

  if exists (
    select 1 from public.ai_jobs j
     where j.workspace_id = v_share.workspace_id
       and j.type = 'export'
       and j.status in ('queued', 'running')
       and j.payload ->> 'share_id' = v_share.id::text
  ) then
    raise exception using errcode = '53400', message = 'project_share_download_busy';
  end if;
  if (
    select count(*) from public.ai_jobs j
     where j.workspace_id = v_share.workspace_id
       and j.type = 'export'
       and j.status in ('queued', 'running')
       and j.payload ? 'share_id'
  ) >= 2 then
    raise exception using errcode = '53400', message = 'project_share_download_busy';
  end if;
  if (
    select count(*) from public.ai_jobs j
     where j.workspace_id = v_share.workspace_id
       and j.type = 'export'
       and j.payload ->> 'share_id' = v_share.id::text
       and j.created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception using errcode = '53400', message = 'project_share_download_limit';
  end if;

  insert into public.ai_jobs (workspace_id, user_id, type, status, payload, total_items, done_items)
  values (
    v_share.workspace_id, null, 'export', 'queued', v_payload, cardinality(v_ids), 0
  )
  returning id into v_job_id;

  update public.project_shares ps
     set download_count = ps.download_count + 1
   where ps.id = v_share.id;

  return query select v_job_id, false;
end;
$$;

-- The recipient's view of one of their own exports. The job's error text is
-- internal, so only a coarse code crosses; the result key must be one of this
-- workspace's export artifacts.
create function public.project_share_download_status(p_token_hash text, p_job_id uuid)
returns table(
  status text,
  progress int,
  progress_label text,
  title text,
  result_key text,
  error text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype := public.project_share_by_token(p_token_hash);
  v_prefix text;
begin
  if v_share.id is null or not v_share.can_download or p_job_id is null then
    return;
  end if;
  v_prefix := v_share.workspace_id::text || '/exports/';

  return query
  select
    j.status::text,
    j.progress,
    j.progress_label,
    j.payload ->> 'title',
    case
      when left(j.payload ->> 'result_key', char_length(v_prefix)) = v_prefix
        then j.payload ->> 'result_key'
    end,
    case
      when j.error is null then null
      when j.error like 'export_too_large%' then 'export_too_large'
      else 'export_failed'
    end
  from public.ai_jobs j
  where j.id = p_job_id
    and j.workspace_id = v_share.workspace_id
    and j.type = 'export'
    and j.payload ->> 'share_id' = v_share.id::text;
end;
$$;

-- Reserve room for up to 100 files. The link row is locked so two concurrent
-- batches cannot both fit under the quota. The route passes each file's
-- display name and a key-safe name (lib/r2 originalKey's sanitizer); this
-- function builds both keys itself.
create function public.reserve_project_share_uploads(
  p_token_hash text,
  p_uploader_name text,
  p_items jsonb
)
returns table(id uuid, staging_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype := public.project_share_by_token(p_token_hash);
  v_uploader text := nullif(btrim(coalesce(p_uploader_name, '')), '');
  v_item jsonb;
  v_files int;
  v_bytes bigint;
  v_new_bytes bigint := 0;
begin
  if v_share.id is null or not v_share.can_upload then
    return;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_project_share_upload';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_project_share_upload';
  end if;
  if v_uploader is not null
     and (char_length(v_uploader) > 80 or v_uploader ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'invalid_project_share_upload';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'filename') is distinct from 'string'
       or jsonb_typeof(v_item -> 'key_name') is distinct from 'string'
       or jsonb_typeof(v_item -> 'mime') is distinct from 'string'
       or jsonb_typeof(v_item -> 'bytes') is distinct from 'number' then
      raise exception using errcode = '22023', message = 'invalid_project_share_upload';
    end if;
    if char_length(v_item ->> 'filename') not between 1 and 255
       or (v_item ->> 'filename') ~ '[[:cntrl:]/\\]'
       or (v_item ->> 'key_name') !~ '^[A-Za-z0-9_.()+ -]{1,200}$'
       or char_length(v_item ->> 'mime') not between 1 and 255
       or (v_item ->> 'mime') ~ '[[:cntrl:]]'
       or (v_item ->> 'bytes')::numeric <> trunc((v_item ->> 'bytes')::numeric)
       or (v_item ->> 'bytes')::numeric not between 1 and 104857600 then
      raise exception using errcode = '22023', message = 'invalid_project_share_upload';
    end if;
    v_new_bytes := v_new_bytes + (v_item ->> 'bytes')::bigint;
  end loop;

  perform 1 from public.project_shares ps
   where ps.id = v_share.id and ps.revoked_at is null and ps.expires_at > now()
   for update;
  if not found then
    return;
  end if;

  -- Abandoned reservations keep counting until the worker sweep has deleted
  -- their bytes and marked them expired; otherwise staging objects nobody
  -- completed would let one link fill far more than its quota.
  select count(*)::int, coalesce(sum(coalesce(psu.actual_bytes, psu.declared_bytes)), 0)::bigint
    into v_files, v_bytes
    from public.project_share_uploads psu
   where psu.share_id = v_share.id
     and psu.status in ('reserved', 'finalizing', 'completed');

  if v_files + jsonb_array_length(p_items) > v_share.max_files
     or v_bytes + v_new_bytes > v_share.max_bytes then
    raise exception using errcode = '53400', message = 'project_share_upload_quota';
  end if;

  return query
  with requested as (
    select gen_random_uuid() as new_id, item.value, item.ordinality
      from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  ), inserted as (
    insert into public.project_share_uploads as psu (
      id, share_id, workspace_id, filename, mime, declared_bytes,
      staging_key, final_key, uploader_name
    )
    select
      r.new_id,
      v_share.id,
      v_share.workspace_id,
      r.value ->> 'filename',
      r.value ->> 'mime',
      (r.value ->> 'bytes')::bigint,
      v_share.workspace_id::text || '/incoming/' || r.new_id::text,
      v_share.workspace_id::text || '/originals/' || r.new_id::text || '/' || (r.value ->> 'key_name'),
      v_uploader
    from requested r
    returning psu.id, psu.staging_key
  )
  select r.new_id, i.staging_key
    from requested r
    join inserted i on i.id = r.new_id
   order by r.ordinality;
end;
$$;

-- Take the right to finalize these reservations. Exactly one caller wins a
-- reservation, so only one request ever copies it into its final key; a
-- claim older than five minutes belongs to a request that died and may be
-- taken again. Reservations past the sweep horizon cannot be claimed.
create function public.claim_project_share_uploads(p_token_hash text, p_ids uuid[])
returns table(id uuid, staging_key text, final_key text, declared_bytes bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype := public.project_share_by_token(p_token_hash);
begin
  if v_share.id is null or not v_share.can_upload then
    return;
  end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_project_share_upload';
  end if;

  return query
  update public.project_share_uploads psu
     set status = 'finalizing',
         claimed_at = now()
   where psu.id = any(p_ids)
     and psu.share_id = v_share.id
     and psu.created_at > now() - interval '2 hours'
     and (
       psu.status = 'reserved'
       or (psu.status = 'finalizing' and psu.claimed_at < now() - interval '5 minutes')
     )
  returning psu.id, psu.staging_key, psu.final_key, psu.declared_bytes;
end;
$$;

-- Record what the route found in R2 for each claimed reservation and turn the
-- good ones into assets — one transaction and one ingest job for the batch.
-- `p_results` is [{id, ok, actual_bytes}] for the reservations this request
-- claimed; `p_ids` is every reservation the browser asked about, so a retry
-- after a lost response learns the outcome of work an earlier request did.
create function public.complete_project_share_uploads(
  p_token_hash text,
  p_results jsonb,
  p_ids uuid[]
)
returns table(id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype := public.project_share_by_token(p_token_hash);
  v_row record;
  v_asset_id uuid;
  v_asset_ids uuid[] := array[]::uuid[];
begin
  if v_share.id is null or not v_share.can_upload then
    return;
  end if;
  if jsonb_typeof(p_results) is distinct from 'array'
     or p_ids is null
     or cardinality(p_ids) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_project_share_upload';
  end if;
  if jsonb_array_length(p_results) > 100 then
    raise exception using errcode = '22023', message = 'invalid_project_share_upload';
  end if;

  perform 1 from public.project_shares ps
   where ps.id = v_share.id and ps.revoked_at is null and ps.expires_at > now()
   for update;
  if not found then
    return;
  end if;

  for v_row in
    select psu.*, result.ok, result.actual_bytes as found_bytes
      from jsonb_to_recordset(p_results) as result(id uuid, ok boolean, actual_bytes bigint)
      join public.project_share_uploads psu
        on psu.id = result.id
       and psu.share_id = v_share.id
       and psu.status = 'finalizing'
     order by psu.created_at, psu.id
     for update of psu
  loop
    if v_row.ok is true
       and v_row.found_bytes is not null
       and v_row.found_bytes = v_row.declared_bytes then
      v_asset_id := gen_random_uuid();

      insert into public.assets (id, workspace_id, added_by, kind, title, received_share_id, received_from)
      values (
        v_asset_id, v_share.workspace_id, null, public.asset_kind_from_mime(v_row.mime),
        v_row.filename, v_share.id, v_row.uploader_name
      );
      insert into public.files (asset_id, workspace_id, origin, r2_key, mime_type, byte_size)
      values (
        v_asset_id, v_share.workspace_id, 'upload', v_row.final_key, v_row.mime, v_row.found_bytes
      );
      -- Membership before the job exists, as complete_upload_batch does: a
      -- dedup merge in ingest moves these links onto the surviving asset.
      insert into public.project_assets (project_id, asset_id, added_by)
      values (v_share.project_id, v_asset_id, null);

      update public.project_share_uploads psu
         set status = 'completed',
             completed_at = now(),
             actual_bytes = v_row.found_bytes,
             asset_id = v_asset_id
       where psu.id = v_row.id;

      v_asset_ids := array_append(v_asset_ids, v_asset_id);
    else
      update public.project_share_uploads psu
         set status = 'rejected',
             actual_bytes = v_row.found_bytes
       where psu.id = v_row.id;
    end if;
  end loop;

  if cardinality(v_asset_ids) > 0 then
    insert into public.ai_jobs (workspace_id, user_id, type, status, payload, total_items, done_items)
    values (
      v_share.workspace_id, null, 'ingest', 'queued',
      jsonb_build_object('asset_ids', to_jsonb(v_asset_ids), 'share_id', v_share.id),
      cardinality(v_asset_ids), 0
    );
    update public.project_shares ps
       set last_upload_at = now()
     where ps.id = v_share.id;
  end if;

  return query
  select psu.id, psu.status
    from public.project_share_uploads psu
   where psu.id = any(p_ids)
     and psu.share_id = v_share.id;
end;
$$;

-- ── worker sweep (retention.ts) ────────────────────────────────────────
-- Expire reservations nobody finished, then hand the worker every settled row
-- whose objects still need deleting: both keys of an expired or rejected
-- reservation, and the staging copy of a completed one once its PUT URL is
-- dead. Never the final key of a completed reservation — that is the asset's
-- original now. Postgres cannot delete R2 bytes, so this is two-phase: the
-- worker deletes, then marks the rows swept; a failed delete retries next tick.
create function public.project_share_uploads_to_sweep(p_limit int default 500)
returns table(id uuid, staging_key text, final_key text)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.project_share_uploads psu
     set status = 'expired'
   where psu.created_at < now() - interval '2 hours'
     and (
       psu.status = 'reserved'
       or (psu.status = 'finalizing' and psu.claimed_at < now() - interval '15 minutes')
     );

  return query
  select
    psu.id,
    psu.staging_key,
    case when psu.status in ('expired', 'rejected') then psu.final_key end
  from public.project_share_uploads psu
  where psu.swept_at is null
    and (
      psu.status in ('expired', 'rejected')
      or (psu.status = 'completed' and psu.completed_at < now() - interval '30 minutes')
    )
  order by psu.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 5000));
end;
$$;

create function public.mark_project_share_uploads_swept(p_ids uuid[])
returns int
language sql
security definer
set search_path = public
as $$
  with swept as (
    update public.project_share_uploads psu
       set swept_at = now()
     where psu.id = any(p_ids)
       and psu.swept_at is null
       and psu.status in ('expired', 'rejected', 'completed')
    returning 1
  )
  select count(*)::int from swept;
$$;

-- Functions are executable by PUBLIC by default. Keep the capability surface
-- explicit: editors manage links; only the fenced Next integration (and the
-- worker) reaches the public surface, as service_role. The anon key is public,
-- so anon must never be able to call a resolver and receive an object key.
revoke all on function public.asset_kind_from_mime(text) from public, anon, authenticated;
revoke all on function public.project_share_by_token(text) from public, anon, authenticated;

revoke all on function public.create_project_share(uuid, boolean, boolean, int, text, text, text) from public, anon;
revoke all on function public.list_project_shares(uuid) from public, anon;
revoke all on function public.extend_project_share(uuid, int) from public, anon;
revoke all on function public.rename_project_share(uuid, text) from public, anon;
revoke all on function public.revoke_project_share(uuid) from public, anon;
revoke all on function public.list_project_share_counts() from public, anon;
revoke all on function public.list_project_share_received(uuid) from public, anon;

grant execute on function public.create_project_share(uuid, boolean, boolean, int, text, text, text) to authenticated, service_role;
grant execute on function public.list_project_shares(uuid) to authenticated, service_role;
grant execute on function public.extend_project_share(uuid, int) to authenticated, service_role;
grant execute on function public.rename_project_share(uuid, text) to authenticated, service_role;
grant execute on function public.revoke_project_share(uuid) to authenticated, service_role;
grant execute on function public.list_project_share_counts() to authenticated, service_role;
grant execute on function public.list_project_share_received(uuid) to authenticated, service_role;

revoke all on function public.open_project_share(text) from public, anon, authenticated;
revoke all on function public.list_project_share_assets(text, timestamptz, uuid, int) from public, anon, authenticated;
revoke all on function public.resolve_project_share_media(text, uuid, text) from public, anon, authenticated;
revoke all on function public.enqueue_project_share_download(text, jsonb) from public, anon, authenticated;
revoke all on function public.project_share_download_status(text, uuid) from public, anon, authenticated;
revoke all on function public.reserve_project_share_uploads(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_project_share_uploads(text, uuid[]) from public, anon, authenticated;
revoke all on function public.complete_project_share_uploads(text, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.project_share_uploads_to_sweep(int) from public, anon, authenticated;
revoke all on function public.mark_project_share_uploads_swept(uuid[]) from public, anon, authenticated;

grant execute on function public.open_project_share(text) to service_role;
grant execute on function public.list_project_share_assets(text, timestamptz, uuid, int) to service_role;
grant execute on function public.resolve_project_share_media(text, uuid, text) to service_role;
grant execute on function public.enqueue_project_share_download(text, jsonb) to service_role;
grant execute on function public.project_share_download_status(text, uuid) to service_role;
grant execute on function public.reserve_project_share_uploads(text, text, jsonb) to service_role;
grant execute on function public.claim_project_share_uploads(text, uuid[]) to service_role;
grant execute on function public.complete_project_share_uploads(text, jsonb, uuid[]) to service_role;
grant execute on function public.project_share_uploads_to_sweep(int) to service_role;
grant execute on function public.mark_project_share_uploads_swept(uuid[]) to service_role;

comment on function public.create_project_share(uuid, boolean, boolean, int, text, text, text) is
  'Editor-only. Mints a live project link from a client-hashed token (and optional AES-GCM copy); 1/7/30/90-day expiry, at most 25 live links per project (ADR 0051).';
comment on function public.list_project_shares(uuid) is
  'Editor-only status, counters and (for live links) the token ciphertext of every unrevoked link of a project. Never the digest (ADR 0051).';
comment on function public.open_project_share(text) is
  'Service-role-only page resolver for /s/:token. Zero rows for every failure; an upload-only link learns no file count (ADR 0051).';
comment on function public.resolve_project_share_media(text, uuid, text) is
  'Service-role-only, one object key for one request; the route exchanges it for a short presign. Keys outside the share''s workspace prefix are refused (ADR 0051).';
comment on function public.complete_project_share_uploads(text, jsonb, uuid[]) is
  'Service-role-only. Turns verified, claimed reservations into assets with share provenance plus one ingest job; idempotent through reservation status (ADR 0051).';
