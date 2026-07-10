-- Migration 0001 — full TECH_SPEC v1.2 §4 schema + §5 RLS + ai_jobs Broadcast
-- (issue #5). Single owner applies via Supabase CLI; PR-only changes.

create extension if not exists vector;

-- ============ shared trigger: updated_at ============
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============ identity & tenancy ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create type member_role as enum ('owner','editor','viewer');
create table memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- ============ sources ============
create type source_provider as enum ('gdrive','dropbox');
create table source_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id),
  provider source_provider not null,
  provider_account_email text,
  access_token_enc text,      -- encrypted app-side (AES-GCM, TOKEN_ENC_KEY); never sent to browser
  refresh_token_enc text,
  scopes text[],
  status text not null default 'active',   -- active | revoked | error
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============ assets & files ============
create type asset_kind   as enum ('photo','pdf','document','other');
create type asset_status as enum ('active','source_missing','deleted');
create type file_origin  as enum ('upload','gdrive','dropbox');

-- Canonical entity: one shot / document. Everything AI/curation references the ASSET.
create table assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  added_by uuid references profiles(id),
  kind asset_kind not null,
  title text,                        -- display name (set from the first file at ingest)
  status asset_status not null default 'active',
  ai_processed_at timestamptz,       -- last successful analyze
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index assets_ws_kind_idx    on assets (workspace_id, kind);
create index assets_ws_created_idx on assets (workspace_id, created_at desc);

-- Physical representations of an asset (original, alt formats, cloud-linked bytes).
-- One asset → many files; one file → one asset.
create table files (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,  -- denormalized: RLS + dedup index
  origin file_origin not null,
  source_connection_id uuid references source_connections(id),
  source_file_id text,               -- Drive/Dropbox file id
  source_path text,                  -- folder path at import time (display/clustering)
  r2_key text,                       -- set for uploads AND Dropbox; null only for Drive-linked files
  mime_type text,
  byte_size bigint,
  content_hash text,                 -- sha256 (computed during ingest)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index files_asset_idx on files (asset_id);
create unique index files_dedup_idx on files (workspace_id, content_hash)
  where content_hash is not null;
-- Dedup: sha256 per file at ingest. On hash conflict do NOT create a new asset —
-- attach the incoming file as another representation of the existing asset (or just
-- link that asset into the target project).

-- Previews + EXIF describe the SHOT, so they hang off the ASSET, not a byte blob.
create table asset_previews (
  asset_id uuid not null references assets(id) on delete cascade,
  size text not null,                -- 'thumb'(256) | 'medium'(1024)
  r2_key text not null,
  width int, height int,
  primary key (asset_id, size)
);

create table asset_exif (
  asset_id uuid primary key references assets(id) on delete cascade,
  taken_at timestamptz,
  camera_make text, camera_model text, lens text,
  gps_lat double precision, gps_lon double precision,
  gps_label text,                    -- reverse-geocoded or manual
  location_source text,              -- 'gps' | 'manual' | 'ai'  (pro cameras often have NO GPS)
  iso int, aperture text, shutter text, focal_length text,
  raw jsonb                          -- full EXIF dump
);
create index asset_exif_taken_idx on asset_exif (taken_at);

-- ============ projects ============
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  caption_prompt text,               -- per-project caption tone/instructions
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table project_assets (
  project_id uuid not null references projects(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  added_by uuid references profiles(id),
  added_at timestamptz default now(),
  primary key (project_id, asset_id)
);

-- ============ AI outputs ============
create type tag_category as enum ('object','scene','place','attribute','event','other');
create type tag_source   as enum ('ai','manual','exif');

create table tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  category tag_category not null default 'other',
  unique (workspace_id, name, category)
);

create table asset_tags (
  asset_id uuid not null references assets(id) on delete cascade,
  tag_id   uuid not null references tags(id)  on delete cascade,
  source tag_source not null default 'ai',
  confidence real,
  primary key (asset_id, tag_id)
);

create type caption_lang  as enum ('en','uk','ru');
create type caption_style as enum ('social','agency','archival');

create table captions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  lang caption_lang not null,
  style caption_style not null,
  text text not null,
  is_edited boolean not null default false,
  generated_by text,                 -- model id
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (asset_id, lang, style)
);

create type fact_status as enum ('confirmed','likely','needs_check');
create table facts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  text text not null,
  status fact_status not null default 'needs_check',
  source text,                       -- 'exif' | 'gps' | 'ai' | 'manual'
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz default now()
);

-- ============ embeddings (unified: photos + doc chunks) ============
create table embeddings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  kind text not null,                -- 'image' | 'doc_chunk'
  chunk_index int not null default 0,
  content text,                      -- embedded text (doc chunks) or AI description (audit / re-embed / fallback)
  embedding vector(768) not null,
  created_at timestamptz default now(),
  unique (asset_id, kind, chunk_index)
);
create index embeddings_hnsw_idx on embeddings using hnsw (embedding vector_cosine_ops);
create index embeddings_ws_idx   on embeddings (workspace_id);
-- pgvector HNSW indexes support ≤ 2000 dims → 768 is safe.
-- Embedding spaces are model-specific: switching models later requires full re-embed.

-- ============ jobs & usage ============
create type job_type   as enum ('ingest','analyze','caption','export');
create type job_status as enum ('queued','running','done','failed','canceled');

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references profiles(id),
  project_id uuid references projects(id),
  type job_type not null,
  status job_status not null default 'queued',
  payload jsonb not null,            -- {asset_ids:[], langs:[], style, options...}
  progress int not null default 0,   -- 0..100
  progress_label text,
  total_items int, done_items int,
  error text,
  cost_usd numeric(10,5),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index ai_jobs_queue_idx on ai_jobs (run_after, created_at) where status = 'queued';

create table usage_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  user_id uuid,
  job_id uuid references ai_jobs(id),
  event_type text not null,          -- image_analyzed | caption_generated | embedding |
                                     -- pdf_processed | search_query | export
  units int not null default 1,
  model text,
  cost_usd numeric(10,6),
  created_at timestamptz default now()
);
create index usage_ws_idx on usage_events (workspace_id, created_at);

-- ============ canvas layouts ============
create table canvas_layouts (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  scope text not null,               -- 'all' or project uuid as text
  overrides jsonb not null default '{}'::jsonb,  -- {hub:{...}, folder:{...}, asset:{id:{x,y}}}
  organize_mode text,                -- 'source' | 'date' | 'place' | 'similarity'
  updated_at timestamptz default now(),
  primary key (workspace_id, user_id, scope)
);

-- ============ updated_at triggers ============
create trigger source_connections_updated_at before update on source_connections
  for each row execute function set_updated_at();
create trigger assets_updated_at before update on assets
  for each row execute function set_updated_at();
create trigger files_updated_at before update on files
  for each row execute function set_updated_at();
create trigger projects_updated_at before update on projects
  for each row execute function set_updated_at();
create trigger captions_updated_at before update on captions
  for each row execute function set_updated_at();
create trigger canvas_layouts_updated_at before update on canvas_layouts
  for each row execute function set_updated_at();

-- ============ RLS helpers (security definer to avoid policy recursion) ============
create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where workspace_id = ws and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.is_editor(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where workspace_id = ws and user_id = auth.uid()
                   and role in ('owner','editor'));
$$;

-- Asset-child tables (asset_previews/asset_exif/asset_tags/captions/facts/
-- project_assets) carry no workspace_id → authorize via their asset's workspace.
create or replace function public.is_member_of_asset(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from assets ast
                 join memberships m on m.workspace_id = ast.workspace_id
                 where ast.id = a and m.user_id = auth.uid());
$$;

create or replace function public.is_editor_of_asset(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from assets ast
                 join memberships m on m.workspace_id = ast.workspace_id
                 where ast.id = a and m.user_id = auth.uid()
                   and m.role in ('owner','editor'));
$$;

-- Profile visibility: yourself + people you share a workspace with.
create or replace function public.shares_workspace_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships a
                 join memberships b on a.workspace_id = b.workspace_id
                 where a.user_id = auth.uid() and b.user_id = other);
$$;

-- ============ grants ============
-- Table-level ACLs (RLS scopes rows on top of these). anon gets nothing on
-- domain tables — every read in this app is authenticated. NOTE for future
-- migrations: repeat grants for newly created tables (or set default privileges).
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
-- (the source_connections token-column revoke below intentionally overrides
--  the broad grant — keep that ordering)

-- ============ RLS: enable + policies on EVERY table ============

-- profiles
alter table profiles enable row level security;
create policy profiles_select on profiles for select
  using (id = auth.uid() or shares_workspace_with(id));
create policy profiles_insert on profiles for insert
  with check (id = auth.uid());
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
alter table workspaces enable row level security;
create policy workspaces_select on workspaces for select using (is_member(id));
create policy workspaces_insert on workspaces for insert
  with check (created_by = auth.uid());
create policy workspaces_update on workspaces for update
  using (is_owner(id)) with check (is_owner(id));
create policy workspaces_delete on workspaces for delete using (is_owner(id));

-- memberships (owner manages; creator may bootstrap themselves as owner)
alter table memberships enable row level security;
create policy memberships_select on memberships for select using (is_member(workspace_id));
create policy memberships_insert on memberships for insert
  with check (
    is_owner(workspace_id)
    or (user_id = auth.uid() and role = 'owner'
        and exists (select 1 from workspaces w
                    where w.id = workspace_id and w.created_by = auth.uid()))
  );
create policy memberships_update on memberships for update
  using (is_owner(workspace_id)) with check (is_owner(workspace_id));
create policy memberships_delete on memberships for delete using (is_owner(workspace_id));

-- source_connections: members may see connection metadata; tokens are
-- column-revoked below; all writes go through server-side (service role) only.
alter table source_connections enable row level security;
create policy source_connections_select on source_connections for select
  using (is_member(workspace_id));
revoke select on table source_connections from anon, authenticated;
grant select (id, workspace_id, user_id, provider, provider_account_email,
              scopes, status, created_at, updated_at)
  on source_connections to authenticated;

-- assets
alter table assets enable row level security;
create policy assets_select on assets for select using (is_member(workspace_id));
create policy assets_insert on assets for insert with check (is_editor(workspace_id));
create policy assets_update on assets for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
create policy assets_delete on assets for delete using (is_editor(workspace_id));

-- files
alter table files enable row level security;
create policy files_select on files for select using (is_member(workspace_id));
create policy files_insert on files for insert with check (is_editor(workspace_id));
create policy files_update on files for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
create policy files_delete on files for delete using (is_editor(workspace_id));

-- asset_previews / asset_exif: written by the worker (service role) only
alter table asset_previews enable row level security;
create policy asset_previews_select on asset_previews for select
  using (is_member_of_asset(asset_id));

alter table asset_exif enable row level security;
create policy asset_exif_select on asset_exif for select
  using (is_member_of_asset(asset_id));

-- projects
alter table projects enable row level security;
create policy projects_select on projects for select using (is_member(workspace_id));
create policy projects_insert on projects for insert with check (is_editor(workspace_id));
create policy projects_update on projects for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
create policy projects_delete on projects for delete using (is_editor(workspace_id));

-- project_assets (M:N; both sides must be in a workspace the user can edit/see)
alter table project_assets enable row level security;
create policy project_assets_select on project_assets for select
  using (exists (select 1 from projects p
                 where p.id = project_id and is_member(p.workspace_id)));
create policy project_assets_insert on project_assets for insert
  with check (is_editor_of_asset(asset_id)
              and exists (select 1 from projects p
                          where p.id = project_id and is_editor(p.workspace_id)));
create policy project_assets_delete on project_assets for delete
  using (exists (select 1 from projects p
                 where p.id = project_id and is_editor(p.workspace_id)));

-- tags
alter table tags enable row level security;
create policy tags_select on tags for select using (is_member(workspace_id));
create policy tags_insert on tags for insert with check (is_editor(workspace_id));
create policy tags_update on tags for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
create policy tags_delete on tags for delete using (is_editor(workspace_id));

-- asset_tags
alter table asset_tags enable row level security;
create policy asset_tags_select on asset_tags for select
  using (is_member_of_asset(asset_id));
create policy asset_tags_insert on asset_tags for insert
  with check (is_editor_of_asset(asset_id));
create policy asset_tags_delete on asset_tags for delete
  using (is_editor_of_asset(asset_id));

-- captions: created by the worker; users may edit (PATCH → is_edited=true)
alter table captions enable row level security;
create policy captions_select on captions for select
  using (is_member_of_asset(asset_id));
create policy captions_update on captions for update
  using (is_editor_of_asset(asset_id)) with check (is_editor_of_asset(asset_id));

-- facts: created by the worker; users confirm / set status
alter table facts enable row level security;
create policy facts_select on facts for select
  using (is_member_of_asset(asset_id));
create policy facts_update on facts for update
  using (is_editor_of_asset(asset_id)) with check (is_editor_of_asset(asset_id));

-- embeddings: read-only for members (search runs server-side anyway)
alter table embeddings enable row level security;
create policy embeddings_select on embeddings for select using (is_member(workspace_id));

-- ai_jobs: members watch progress; editors enqueue; worker (service role) updates
alter table ai_jobs enable row level security;
create policy ai_jobs_select on ai_jobs for select using (is_member(workspace_id));
create policy ai_jobs_insert on ai_jobs for insert with check (is_editor(workspace_id));

-- usage_events: audit trail — readable by members, written server-side only
alter table usage_events enable row level security;
create policy usage_events_select on usage_events for select using (is_member(workspace_id));

-- canvas_layouts: strictly per-user within a workspace
alter table canvas_layouts enable row level security;
create policy canvas_layouts_select on canvas_layouts for select
  using (user_id = auth.uid() and is_member(workspace_id));
create policy canvas_layouts_insert on canvas_layouts for insert
  with check (user_id = auth.uid() and is_member(workspace_id));
create policy canvas_layouts_update on canvas_layouts for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_member(workspace_id));
create policy canvas_layouts_delete on canvas_layouts for delete
  using (user_id = auth.uid());

-- ============ Realtime: job progress via Broadcast from Database (ADR 0009) ============
-- AFTER trigger on ai_jobs broadcasts to the private channel 'workspace:<uuid>';
-- clients call supabase.realtime.setAuth() and subscribe to that private channel.
create or replace function public.ai_jobs_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.broadcast_changes(
    'workspace:' || coalesce(new.workspace_id, old.workspace_id)::text,  -- topic
    tg_op,                                                               -- event
    tg_op,                                                               -- operation
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end $$;

create trigger ai_jobs_broadcast_trg
  after insert or update or delete on ai_jobs
  for each row execute function ai_jobs_broadcast();

-- Authorize receiving broadcasts: workspace members only ('workspace:' = 10 chars).
-- CASE (not AND) so the ::uuid cast can never run on a non-matching topic —
-- Postgres does not guarantee AND evaluation order.
create policy workspace_broadcasts_select on realtime.messages for select
  to authenticated
  using (
    case
      when realtime.topic() ~* '^workspace:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then is_member(substring(realtime.topic() from 11)::uuid)
      else false
    end
  );
