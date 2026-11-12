-- Share scopes and opt-in details — ADR 0053 (amends ADR 0051).
--
-- A project share link (ADR 0051) could only ever carry a whole project. This
-- gives every link a SCOPE, still inside its one project:
--
--   project    every live file of the project (unchanged; the default)
--   board      the live files of one Workspace, following its membership
--   selection  a fixed list of files picked at creation; it never grows
--
-- and lets the owner turn on, per link, details the recipient may see:
-- Workspaces as a filter (project scope only), colour labels, tags, and one
-- caption (language × style). All of them are off by default, so a link made
-- the ADR 0051 way still shows files and nothing else.
--
-- Two rules carry the design:
--
--   * One definition of liveness, one definition of content.
--     project_share_is_live() is what project_share_by_token() and both editor
--     listings now ask; project_share_scope_assets() is the only place that
--     says which files a link carries, and every public resolver joins it.
--     Every scope is a SUBSET of the project's active files, so nothing here
--     can widen what ADR 0051 already exposed.
--
--   * SQL enforces the details, not the UI. A detail that is off comes back
--     null, and a filter on a detail that is off is refused (22023 → the
--     route's one 404), or the filter itself would answer the question.
--
-- Backward compatible on purpose: every changed signature only APPENDS
-- parameters with defaults, and every changed result only APPENDS columns, so
-- the web build already deployed keeps working against this schema until the
-- next one ships. (Its row parsers are non-strict zod objects.)

-- ── schema ──────────────────────────────────────────────────────────────

create type public.project_share_scope as enum ('project', 'board', 'selection');

alter table public.project_shares
  add column scope public.project_share_scope not null default 'project',
  -- SET NULL, not CASCADE: permanently deleting a Workspace must not erase the
  -- link's upload ledger or the provenance (assets.received_share_id) of files
  -- that arrived through it. A board link whose board is gone is simply dead.
  add column board_id uuid references public.boards(id) on delete set null,
  add column show_boards boolean not null default false,
  add column show_labels boolean not null default false,
  add column show_tags boolean not null default false,
  add column caption_lang public.caption_lang,
  add column caption_style public.caption_style,
  add constraint project_shares_board_needs_board_scope
    check (board_id is null or scope = 'board'),
  -- A fixed list cannot receive files: an upload would have nowhere to land
  -- that the recipient could see again.
  add constraint project_shares_selection_is_download_only
    check (scope <> 'selection' or not can_upload),
  add constraint project_shares_board_facet_needs_project_scope
    check (not show_boards or scope = 'project'),
  add constraint project_shares_caption_pair
    check ((caption_lang is null) = (caption_style is null)),
  add constraint project_shares_details_need_download
    check (can_download or not (show_boards or show_labels or show_tags or caption_lang is not null));

create index project_shares_board_idx
  on public.project_shares (board_id)
  where board_id is not null;

-- The fixed list of a `selection` link. Membership only: the files themselves
-- still have to be live in the project to be served.
create table public.project_share_assets (
  share_id uuid not null references public.project_shares(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  primary key (share_id, asset_id)
);

create index project_share_assets_asset_idx
  on public.project_share_assets (asset_id);

comment on table public.project_share_assets is
  'The fixed file list of a selection-scoped project share (ADR 0053). Never grows; a member must still be live in the project to be served. No anon/authenticated access.';
comment on column public.project_shares.scope is
  'What the link carries inside its project: every live file, one Workspace (board_id), or a fixed list (project_share_assets). ADR 0053.';

alter table public.project_share_assets enable row level security;
revoke all on table public.project_share_assets from public, anon, authenticated;
grant all on table public.project_share_assets to service_role;

-- ── one definition of liveness, one of content ──────────────────────────

-- ADR 0051 §4's rule, plus: a Workspace link lives only while its Workspace
-- does. Trash pauses the link and Restore resumes it, exactly as a project's
-- Trash already did.
create function public.project_share_is_live(p_share public.project_shares)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_share.id is not null
     and p_share.revoked_at is null
     and p_share.expires_at > now()
     and exists (
       select 1 from public.projects p
        where p.id = p_share.project_id
          and p.workspace_id = p_share.workspace_id
          and p.deleted_at is null
     )
     and exists (
       select 1 from public.memberships m
        where m.workspace_id = p_share.workspace_id
          and m.user_id = p_share.created_by
          and m.role in ('owner', 'editor')
     )
     and (
       p_share.scope <> 'board'
       or exists (
         select 1 from public.boards b
          where b.id = p_share.board_id
            and b.project_id = p_share.project_id
            and b.workspace_id = p_share.workspace_id
            and b.deleted_at is null
       )
     );
$$;

-- The files a link carries right now. Always a subset of the project's active
-- files in the link's own workspace; a Workspace or a list can only narrow it.
create function public.project_share_scope_assets(p_share public.project_shares)
returns table(asset_id uuid)
language sql
stable
set search_path = public
as $$
  select a.id
    from public.project_assets pa
    join public.assets a
      on a.id = pa.asset_id
     and a.workspace_id = p_share.workspace_id
     and a.status = 'active'
   where pa.project_id = p_share.project_id
     and case p_share.scope
       when 'project' then true
       when 'board' then exists (
         select 1
           from public.board_assets ba
           join public.boards b on b.id = ba.board_id
          where ba.board_id = p_share.board_id
            and ba.asset_id = a.id
            and b.project_id = p_share.project_id
            and b.workspace_id = p_share.workspace_id
            and b.deleted_at is null
       )
       when 'selection' then exists (
         select 1 from public.project_share_assets psa
          where psa.share_id = p_share.id
            and psa.asset_id = a.id
       )
       else false
     end;
$$;

create or replace function public.project_share_by_token(p_token_hash text)
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
   where ps.token_hash = decode(lower(p_token_hash), 'hex')
     and public.project_share_is_live(ps);

  if not found then
    return null;
  end if;
  return v_share;
end;
$$;

-- ── editor-side management ─────────────────────────────────────────────

drop function public.create_project_share(uuid, boolean, boolean, int, text, text, text);

create function public.create_project_share(
  p_project_id uuid,
  p_can_download boolean,
  p_can_upload boolean,
  p_expires_in_days int,
  p_label text,
  p_token_hash text,
  p_token_ciphertext text,
  p_scope text default 'project',
  p_board_id uuid default null,
  p_asset_ids uuid[] default null,
  p_show_boards boolean default false,
  p_show_labels boolean default false,
  p_show_tags boolean default false,
  p_caption_lang text default null,
  p_caption_style text default null
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
  v_scope public.project_share_scope;
  v_show_boards boolean := coalesce(p_show_boards, false);
  v_show_labels boolean := coalesce(p_show_labels, false);
  v_show_tags boolean := coalesce(p_show_tags, false);
  v_caption_lang public.caption_lang;
  v_caption_style public.caption_style;
  v_ids uuid[];
  v_share_id uuid;
  v_created_at timestamptz;
  v_expires_at timestamptz;
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

  -- Scope. Text in, so a bad value is a 22023 like every other refusal here
  -- rather than an enum cast error.
  if p_scope is null or p_scope not in ('project', 'board', 'selection') then
    raise exception using errcode = '22023', message = 'invalid_project_share_scope';
  end if;
  v_scope := p_scope::public.project_share_scope;

  if v_scope = 'board' then
    if p_board_id is null or not exists (
      select 1 from public.boards b
       where b.id = p_board_id
         and b.project_id = p_project_id
         and b.workspace_id = v_workspace_id
         and b.deleted_at is null
    ) then
      raise exception using errcode = '22023', message = 'invalid_project_share_board';
    end if;
  elsif p_board_id is not null then
    raise exception using errcode = '22023', message = 'invalid_project_share_board';
  end if;

  if v_scope = 'selection' then
    if p_can_upload then
      raise exception using errcode = '22023', message = 'invalid_project_share_rights';
    end if;
    if p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 2000 then
      raise exception using errcode = '22023', message = 'invalid_project_share_selection';
    end if;
    -- Only what is live in THIS project may be listed; anything else the
    -- browser sent is dropped here, never stored.
    select array_agg(distinct a.id) into v_ids
      from unnest(p_asset_ids) as req(asset_id)
      join public.project_assets pa
        on pa.asset_id = req.asset_id
       and pa.project_id = p_project_id
      join public.assets a
        on a.id = req.asset_id
       and a.workspace_id = v_workspace_id
       and a.status = 'active';
    if v_ids is null then
      raise exception using errcode = '22023', message = 'project_share_selection_empty';
    end if;
  elsif p_asset_ids is not null then
    raise exception using errcode = '22023', message = 'invalid_project_share_selection';
  end if;

  -- Details: opt-in, download links only, Workspaces only on a project link.
  if v_show_boards and v_scope <> 'project' then
    raise exception using errcode = '22023', message = 'invalid_project_share_details';
  end if;
  if (p_caption_lang is null) <> (p_caption_style is null) then
    raise exception using errcode = '22023', message = 'invalid_project_share_details';
  end if;
  if p_caption_lang is not null then
    if p_caption_lang not in (select e::text from unnest(enum_range(null::public.caption_lang)) e)
       or p_caption_style not in (select e::text from unnest(enum_range(null::public.caption_style)) e) then
      raise exception using errcode = '22023', message = 'invalid_project_share_details';
    end if;
    v_caption_lang := p_caption_lang::public.caption_lang;
    v_caption_style := p_caption_style::public.caption_style;
  end if;
  if not p_can_download
     and (v_show_boards or v_show_labels or v_show_tags or v_caption_lang is not null) then
    raise exception using errcode = '22023', message = 'invalid_project_share_details';
  end if;

  -- One bound for every scope: a project has at most 25 open windows.
  select count(*)::int into v_live
    from public.project_shares ps
   where ps.project_id = p_project_id
     and ps.revoked_at is null
     and ps.expires_at > now();
  if v_live >= 25 then
    raise exception using errcode = '53400', message = 'project_share_limit';
  end if;

  insert into public.project_shares as ps (
    workspace_id, project_id, label, can_download, can_upload,
    token_hash, token_ciphertext, expires_at, created_by,
    scope, board_id, show_boards, show_labels, show_tags, caption_lang, caption_style
  ) values (
    v_workspace_id, p_project_id, v_label, p_can_download, p_can_upload,
    decode(lower(p_token_hash), 'hex'), p_token_ciphertext,
    now() + make_interval(days => p_expires_in_days), auth.uid(),
    v_scope, p_board_id, v_show_boards, v_show_labels, v_show_tags, v_caption_lang, v_caption_style
  )
  returning ps.id, ps.created_at, ps.expires_at
  into v_share_id, v_created_at, v_expires_at;

  if v_ids is not null then
    insert into public.project_share_assets (share_id, asset_id)
    select v_share_id, x.asset_id from unnest(v_ids) as x(asset_id);
  end if;

  return query select v_share_id, v_created_at, v_expires_at;
end;
$$;

-- Every unrevoked link of a project with its status, counters, and now its
-- scope, how many files that scope holds right now, and which details it
-- shows. The ciphertext is returned for live links only; the digest never.
drop function public.list_project_shares(uuid);

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
  max_bytes bigint,
  scope text,
  board_id uuid,
  board_name text,
  board_color text,
  file_count int,
  show_boards boolean,
  show_labels boolean,
  show_tags boolean,
  caption_lang text,
  caption_style text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select p.workspace_id into v_workspace_id
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
        when not public.project_share_is_live(ps) then 'inactive'
        else 'live'
      end as link_status,
      (select count(*)::int from public.project_share_scope_assets(ps)) as scope_count
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
    s.max_bytes,
    s.scope::text,
    s.board_id,
    b.name,
    b.color::text,
    s.scope_count,
    s.show_boards,
    s.show_labels,
    s.show_tags,
    s.caption_lang::text,
    s.caption_style::text
  from shares s
  left join public.profiles pr on pr.id = s.created_by
  left join public.boards b on b.id = s.board_id
  left join lateral (
    select count(*) as files, sum(psu.actual_bytes) as bytes
      from public.project_share_uploads psu
     where psu.share_id = s.id
       and psu.status = 'completed'
  ) u on true
  order by s.created_at desc;
end;
$$;

-- The homepage card's "shared" marker. Same rule as a link's own liveness.
create or replace function public.list_project_share_counts()
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
   where public.project_share_is_live(ps)
   group by ps.project_id;
end;
$$;

-- The Workspace chip's marker: live links per Workspace of one project, for
-- any member, like the card counts above.
create function public.list_board_share_counts(p_project_id uuid)
returns table(board_id uuid, live_count int)
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
  select ps.board_id, count(*)::int
    from public.project_shares ps
    join public.memberships caller
      on caller.workspace_id = ps.workspace_id
     and caller.user_id = auth.uid()
   where ps.project_id = p_project_id
     and ps.scope = 'board'
     and public.project_share_is_live(ps)
   group by ps.board_id;
end;
$$;

-- What a link carries right now, for "Show on canvas" on any link (the
-- received list stays its own function: that is what ARRIVED, this is what is
-- SHOWN). Editors only, revoked links included, like the received list.
create function public.list_project_share_scope(p_share_id uuid)
returns table(asset_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_share public.project_shares%rowtype;
begin
  select ps.* into v_share from public.project_shares ps where ps.id = p_share_id;
  if not found or not public.is_editor(v_share.workspace_id) then
    raise insufficient_privilege using message = 'project_share_editor_required';
  end if;

  return query
  select sc.asset_id from public.project_share_scope_assets(v_share) sc;
end;
$$;

-- ── public surface: service_role only ──────────────────────────────────

-- The page. Adds what the page needs to say WHAT it shows (scope and, for a
-- Workspace link, that Workspace's name and colour) and which details are on.
-- An upload-only link still learns no file count.
drop function public.open_project_share(text);

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
  used_bytes bigint,
  scope text,
  board_name text,
  board_color text,
  show_boards boolean,
  show_labels boolean,
  show_tags boolean,
  caption_lang text,
  caption_style text
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
      select count(*)::int from public.project_share_scope_assets(v_share)
    ) end,
    case when v_share.can_upload then v_share.max_files end,
    case when v_share.can_upload then v_share.max_bytes end,
    case when v_share.can_upload then coalesce(q.files, 0)::int end,
    case when v_share.can_upload then coalesce(q.bytes, 0)::bigint end,
    v_share.scope::text,
    b.name,
    b.color::text,
    v_share.show_boards,
    v_share.show_labels,
    v_share.show_tags,
    v_share.caption_lang::text,
    v_share.caption_style::text
  from public.projects p
  join public.workspaces w on w.id = p.workspace_id
  left join public.boards b on b.id = v_share.board_id
  left join lateral (
    select count(*) as files, sum(coalesce(psu.actual_bytes, psu.declared_bytes)) as bytes
      from public.project_share_uploads psu
     where psu.share_id = v_share.id
       and psu.status in ('reserved', 'finalizing', 'completed')
  ) q on true
  where p.id = v_share.project_id;
end;
$$;

-- One page of the link's live files, newest capture first, keyset-paged by
-- (sort_at, id) as before. Now scoped, optionally filtered, and carrying the
-- details the link turned on — null for every one it did not. A filter on a
-- detail that is off, or on a Workspace outside the project, is refused.
drop function public.list_project_share_assets(text, timestamptz, uuid, int);

create function public.list_project_share_assets(
  p_token_hash text,
  p_before_sort_at timestamptz,
  p_before_id uuid,
  p_limit int,
  p_board_id uuid default null,
  p_label text default null,
  p_tag text default null
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
  sort_at timestamptz,
  label text,
  tags text[],
  caption text
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
  if p_board_id is not null and (
    not v_share.show_boards
    or not exists (
      select 1 from public.boards b
       where b.id = p_board_id
         and b.project_id = v_share.project_id
         and b.workspace_id = v_share.workspace_id
         and b.deleted_at is null
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_project_share_filter';
  end if;
  if p_label is not null and (
    not v_share.show_labels
    or p_label not in (select e::text from unnest(enum_range(null::public.asset_label)) e)
  ) then
    raise exception using errcode = '22023', message = 'invalid_project_share_filter';
  end if;
  if p_tag is not null and (
    not v_share.show_tags or char_length(p_tag) not between 1 and 200
  ) then
    raise exception using errcode = '22023', message = 'invalid_project_share_filter';
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
    coalesce(ex.taken_at, a.created_at) as sort_at,
    case when v_share.show_labels then a.label::text end,
    case when v_share.show_tags then tg.names end,
    case when v_share.caption_lang is not null then cap.text end
  from public.project_share_scope_assets(v_share) sc
  join public.assets a on a.id = sc.asset_id
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
  -- At most 24 names per file, strongest first, then printed alphabetically.
  left join lateral (
    select array_agg(x.name order by x.name) as names
      from (
        select t.name
          from public.asset_tags atg
          join public.tags t on t.id = atg.tag_id
         where atg.asset_id = a.id
         group by t.name
         order by max(coalesce(atg.confidence, 1)) desc, t.name
         limit 24
      ) x
  ) tg on v_share.show_tags
  left join public.captions cap
    on v_share.caption_lang is not null
   and cap.asset_id = a.id
   and cap.lang = v_share.caption_lang
   and cap.style = v_share.caption_style
  where (
      p_before_sort_at is null
      or (coalesce(ex.taken_at, a.created_at), a.id) < (p_before_sort_at, p_before_id)
    )
    and (p_board_id is null or exists (
      select 1 from public.board_assets ba
       where ba.board_id = p_board_id
         and ba.asset_id = a.id
    ))
    and (p_label is null or a.label::text = p_label)
    and (p_tag is null or exists (
      select 1
        from public.asset_tags atf
        join public.tags tf on tf.id = atf.tag_id
       where atf.asset_id = a.id
         and tf.name = p_tag
    ))
  order by coalesce(ex.taken_at, a.created_at) desc, a.id desc
  limit p_limit;
end;
$$;

-- The filter row of the page: one row per value of each detail the link turned
-- on, with how many of the link's files carry it. Counted in SQL for ADR 0049's
-- reason — the page loads 200 files at a time, so the browser cannot know an
-- honest total. Nothing for an upload-only link or a link with no details on.
create function public.list_project_share_facets(p_token_hash text)
returns table(facet text, value text, name text, color text, file_count int)
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

  if v_share.show_boards then
    return query
    select 'board'::text, b.id::text, b.name, b.color::text, count(*)::int
      from public.project_share_scope_assets(v_share) sc
      join public.board_assets ba on ba.asset_id = sc.asset_id
      join public.boards b
        on b.id = ba.board_id
       and b.project_id = v_share.project_id
       and b.workspace_id = v_share.workspace_id
       and b.deleted_at is null
     group by b.id, b.name, b.color, b.sort_order
     order by b.sort_order, b.name;
  end if;

  if v_share.show_labels then
    return query
    select 'label'::text, a.label::text, null::text, a.label::text, count(*)::int
      from public.project_share_scope_assets(v_share) sc
      join public.assets a on a.id = sc.asset_id
     where a.label is not null
     group by a.label
     order by a.label;
  end if;

  if v_share.show_tags then
    return query
    select 'tag'::text, t.name, t.name, null::text, count(distinct sc.asset_id)::int
      from public.project_share_scope_assets(v_share) sc
      join public.asset_tags atg on atg.asset_id = sc.asset_id
      join public.tags t on t.id = atg.tag_id
     group by t.name
     order by count(distinct sc.asset_id) desc, t.name
     limit 40;
  end if;
end;
$$;

-- Unchanged but for the membership join: the file must be in the link's scope.
create or replace function public.resolve_project_share_media(
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
    from public.project_share_scope_assets(v_share) sc
    join public.assets a on a.id = sc.asset_id
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
   where sc.asset_id = p_asset_id;

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

-- Unchanged but for the membership join: a ZIP carries only ids in the scope.
create or replace function public.enqueue_project_share_download(p_token_hash text, p_payload jsonb)
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
    join public.project_share_scope_assets(v_share) sc
      on sc.asset_id = requested.asset_id;

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

-- A file sent through a Workspace link lands in that Workspace as well as the
-- project. Ingest's dedup needs no change for it: a merge moves PROJECT
-- membership onto the survivor and the duplicate's Workspace membership dies
-- with it, so a sender holding the bytes of a project photo that is outside
-- the Workspace can never pull it in (ADR 0053).
create or replace function public.complete_project_share_uploads(
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
      if v_share.scope = 'board' then
        insert into public.board_assets (board_id, asset_id, position, added_by)
        values (
          v_share.board_id,
          v_asset_id,
          coalesce((
            select max(ba.position) + 1
              from public.board_assets ba
             where ba.board_id = v_share.board_id
          ), 0),
          null
        );
      end if;

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

-- ── privileges ─────────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps the grants of the functions replaced above. Every
-- function created afresh starts executable by PUBLIC (and by Supabase's
-- default privileges), so each is narrowed explicitly, as ADR 0051 did.

revoke all on function public.project_share_is_live(public.project_shares) from public, anon, authenticated;
revoke all on function public.project_share_scope_assets(public.project_shares) from public, anon, authenticated;
grant execute on function public.project_share_is_live(public.project_shares) to service_role;
grant execute on function public.project_share_scope_assets(public.project_shares) to service_role;

revoke all on function public.create_project_share(uuid, boolean, boolean, int, text, text, text, text, uuid, uuid[], boolean, boolean, boolean, text, text) from public, anon;
revoke all on function public.list_project_shares(uuid) from public, anon;
revoke all on function public.list_board_share_counts(uuid) from public, anon;
revoke all on function public.list_project_share_scope(uuid) from public, anon;
grant execute on function public.create_project_share(uuid, boolean, boolean, int, text, text, text, text, uuid, uuid[], boolean, boolean, boolean, text, text) to authenticated, service_role;
grant execute on function public.list_project_shares(uuid) to authenticated, service_role;
grant execute on function public.list_board_share_counts(uuid) to authenticated, service_role;
grant execute on function public.list_project_share_scope(uuid) to authenticated, service_role;

revoke all on function public.open_project_share(text) from public, anon, authenticated;
revoke all on function public.list_project_share_assets(text, timestamptz, uuid, int, uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_project_share_facets(text) from public, anon, authenticated;
grant execute on function public.open_project_share(text) to service_role;
grant execute on function public.list_project_share_assets(text, timestamptz, uuid, int, uuid, text, text) to service_role;
grant execute on function public.list_project_share_facets(text) to service_role;

comment on function public.project_share_is_live(public.project_shares) is
  'The one definition of a live project share: not revoked, before its deadline, project not in Trash, creator still owner/editor, and for a Workspace link its Workspace not in Trash (ADR 0051 §4, ADR 0053).';
comment on function public.project_share_scope_assets(public.project_shares) is
  'The one definition of what a project share carries: the project''s active files, narrowed to one Workspace or a fixed list by scope (ADR 0053).';
comment on function public.create_project_share(uuid, boolean, boolean, int, text, text, text, text, uuid, uuid[], boolean, boolean, boolean, text, text) is
  'Editor-only. Mints a live link over a project, one of its Workspaces, or a fixed list of its files, with opt-in details; 1/7/30/90-day expiry, at most 25 live links per project (ADR 0051, ADR 0053).';
comment on function public.list_project_shares(uuid) is
  'Editor-only status, scope, current file count, details and (for live links) the token ciphertext of every unrevoked link of a project. Never the digest (ADR 0051, ADR 0053).';
comment on function public.open_project_share(text) is
  'Service-role-only page resolver for /s/:token. Zero rows for every failure; an upload-only link learns no file count (ADR 0051, ADR 0053).';
comment on function public.list_project_share_assets(text, timestamptz, uuid, int, uuid, text, text) is
  'Service-role-only keyset page of a link''s files. Details the link did not turn on come back null; a filter on one is refused with 22023 (ADR 0053).';
comment on function public.list_project_share_facets(text) is
  'Service-role-only filter row of /s/:token: Workspaces, colour labels and top tags with counts, only for details the link turned on (ADR 0053).';
comment on function public.list_project_share_scope(uuid) is
  'Editor-only: the files a link carries now, for Show on canvas (ADR 0053).';
comment on function public.list_board_share_counts(uuid) is
  'Member-visible count of live Workspace links per Workspace of one project, for the chip marker (ADR 0053).';
