-- Content drafts become durable — ADR 0045 amendment.
--
-- ADR 0045 shipped Article/Carousel drafts in `localStorage` and named a server
-- domain as the follow-up. This is that follow-up, and it is not a nicety: the
-- draft holds the text a person wrote. Tile positions may live in a browser
-- because they are one user's view of data that exists elsewhere (ADR 0022);
-- a draft exists NOWHERE else, so clearing site data destroyed the work. ADR
-- 0046 sharpened it further — a published `/p/{token}` link outlives its draft,
-- and `publication_shares.source_draft_id` then pointed at an id no longer in
-- existence.
--
-- The browser keeps writing `localStorage` first and syncs here: the editor's
-- save path stays synchronous and a lost network degrades to exactly today's
-- behaviour instead of blocking typing. This table is the durable copy of
-- record, and `client_id` preserves the browser's own draft id so an adopted
-- draft keeps its identity — and its link to any publication already made.

create table public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- A draft is authored against one Workspace's file set, so it is board
  -- content and dies with a hard-deleted board. A 30-day board trash/restore
  -- keeps it, because the board row survives that window (ADR 0044).
  board_id uuid not null references public.boards(id) on delete cascade,
  -- The browser's own draft id. NOT a second identity for its own sake: it is
  -- what `publication_shares.source_draft_id` already stores, so adopting a
  -- local draft must not mint a new one or the published link loses its source.
  client_id text not null check (
    char_length(btrim(client_id)) between 1 and 200
  ),
  kind text not null check (kind in ('article', 'instagram_carousel')),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  -- The whole draft envelope, validated by the same zod schema the editor uses.
  -- Kept as one document rather than shredded into columns because the editor
  -- saves it whole: a half-written article is one value, and a block model here
  -- would have to be migrated every time the editor grows a field.
  document jsonb not null check (
    jsonb_typeof(document) = 'object'
    and pg_column_size(document) <= 1048576
  ),
  -- The editor's own optimistic counter. Last-write-wins is resolved on this,
  -- not on updated_at: two tabs can write inside one clock tick.
  version int not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, client_id)
);

create index content_drafts_board_idx
  on public.content_drafts (board_id, updated_at desc)
  where deleted_at is null;

create trigger content_drafts_updated_at
  before update on public.content_drafts
  for each row execute function public.set_updated_at();

comment on table public.content_drafts is
  'Durable copy of a browser-authored Article/Carousel draft (ADR 0045 amendment). The browser writes localStorage first and syncs here; client_id preserves the draft id that publication_shares.source_draft_id refers to.';
comment on column public.content_drafts.client_id is
  'The browser-generated draft id. Adoption must reuse it: a publication already made from this draft references it by this value.';
comment on column public.content_drafts.version is
  'The editor''s optimistic counter. A write with a lower version than the stored row is a stale tab and is refused.';

alter table public.content_drafts enable row level security;

-- init.sql:318 note — the blanket `grant all on all tables` only covered the
-- tables that existed then, so a new one needs its own. RLS scopes rows on top.
grant all on table public.content_drafts to authenticated, service_role;

-- Same shape as every other member-scoped table: read as a member, write as an
-- editor. Unlike publication_shares this is authoring data, not an anonymous
-- capability, so normal RLS is the whole boundary and no resolver is involved.
create policy content_drafts_select on public.content_drafts
  for select using (public.is_member(workspace_id));

create policy content_drafts_insert on public.content_drafts
  for insert with check (
    public.is_editor(workspace_id)
    and exists (
      select 1 from public.boards b
       where b.id = board_id
         and b.workspace_id = content_drafts.workspace_id
    )
  );

create policy content_drafts_update on public.content_drafts
  for update using (public.is_editor(workspace_id))
  with check (public.is_editor(workspace_id));

create policy content_drafts_delete on public.content_drafts
  for delete using (public.is_editor(workspace_id));

-- Save is an upsert keyed by the browser's draft id, so a retry after a dropped
-- response cannot create a second copy of the same draft. Stale writes are
-- refused rather than merged: the editor holds the whole document, so a second
-- tab's older envelope would silently undo the newer one's paragraphs.
create function public.save_content_draft(
  p_board_id uuid,
  p_client_id text,
  p_kind text,
  p_name text,
  p_document jsonb,
  p_version int
)
-- The OUT names are prefixed on purpose: a `returns table(client_id …)` column
-- shadows the table's own column inside the body, and `on conflict (client_id)`
-- then resolves to the variable and fails as ambiguous.
returns table(
  draft_id uuid,
  draft_client_id text,
  draft_version int,
  draft_updated_at timestamptz,
  is_stale boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_existing public.content_drafts%rowtype;
begin
  if p_board_id is null
     or p_client_id is null
     or char_length(btrim(p_client_id)) not between 1 and 200
     or p_kind is null or p_kind not in ('article', 'instagram_carousel')
     or p_name is null or char_length(btrim(p_name)) not between 1 and 160
     or p_document is null or jsonb_typeof(p_document) <> 'object'
     or pg_column_size(p_document) > 1048576
     or p_version is null or p_version < 1 then
    raise exception using errcode = '22023', message = 'invalid_content_draft';
  end if;

  select b.workspace_id into v_workspace_id
    from public.boards b
   where b.id = p_board_id and b.deleted_at is null;

  if not found or not public.is_editor(v_workspace_id) then
    raise insufficient_privilege using message = 'content_draft_editor_required';
  end if;

  select * into v_existing
    from public.content_drafts cd
   where cd.workspace_id = v_workspace_id
     and cd.client_id = btrim(p_client_id)
   for update;

  -- A draft restored by undo after a delete comes back with its own id and a
  -- version that legitimately continues the old one, so a soft-deleted row is
  -- revived rather than treated as a conflict.
  if found and v_existing.deleted_at is null and v_existing.version > p_version then
    return query select v_existing.id, v_existing.client_id, v_existing.version,
                        v_existing.updated_at, true;
    return;
  end if;

  return query
  insert into public.content_drafts as cd (
    workspace_id, board_id, client_id, kind, name, document, version, created_by
  ) values (
    v_workspace_id, p_board_id, btrim(p_client_id), p_kind, btrim(p_name),
    p_document, p_version, auth.uid()
  )
  on conflict (workspace_id, client_id) do update
     set board_id = excluded.board_id,
         kind = excluded.kind,
         name = excluded.name,
         document = excluded.document,
         version = excluded.version,
         deleted_at = null
  returning cd.id, cd.client_id, cd.version, cd.updated_at, false;
end;
$$;

revoke all on function public.save_content_draft(uuid, text, text, text, jsonb, int)
  from public, anon;
grant execute on function public.save_content_draft(uuid, text, text, text, jsonb, int)
  to authenticated, service_role;

comment on function public.save_content_draft(uuid, text, text, text, jsonb, int) is
  'Editor-only upsert of one browser-authored draft, keyed by its own client id so a retry cannot duplicate it. Returns stale=true instead of overwriting when the stored version is newer (ADR 0045 amendment).';
