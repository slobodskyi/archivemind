-- Workspaces — ADR 0044. A named, colour-coded set of a project's files that
-- narrows the canvas to them. "Workspace" is the UI word; in the schema and the
-- code it is a **board**, because `workspace_id` already means the tenant and
-- two things called workspace in one query is how the wrong one gets joined.
--
-- This is the durable home for what shipped in `localStorage`: the client owned
-- the ids and the membership, so a workspace existed in exactly one browser.
--
-- What lives here and what does NOT, same split as canvas_groups (ADR 0034):
--   • MEMBERSHIP, name, colour and order are DATA → these tables.
--   • The on-canvas GEOMETRY of the tiles stays a per-user client override in
--     localStorage. ADR 0022 still holds; nothing about layout moves here.
--
-- A board is a curated SUBSET, not a container of bytes: deleting one cascades
-- its membership rows and clears `board_id` on the objects it owned, and every
-- asset survives — exactly what deleting a project or a folder does.

create table boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- NOT NULL, unlike canvas_groups.project_id: a workspace is a working subset
  -- of one project. The 'all' canvas is the read-only recovery grid and has no
  -- browser to open one from, so a null here would be a row nothing can reach.
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  -- One of the seven ADR 0040 colours. Reuses `asset_label` rather than a new
  -- enum so the chip, the swatch row and the photo dot cannot drift apart.
  color asset_label not null default 'blue',
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index boards_ws_project_idx on boards (workspace_id, project_id);

create table board_assets (
  board_id uuid not null references boards(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  position int not null default 0,
  added_by uuid references profiles(id),
  added_at timestamptz default now(),
  primary key (board_id, asset_id)
);
create index board_assets_asset_idx on board_assets (asset_id);

create trigger boards_updated_at before update on boards
  for each row execute function set_updated_at();

-- ── What a board OWNS ────────────────────────────────────────────────────
-- A photo is many-to-many (it lives in the project and can sit in several
-- boards) — hence board_assets. A sticky note, a folder and an artboard are
-- MADE in one place and belong there, so ownership is a single column on the
-- object, not a join. This replaces the client-side noteIds/groupIds lists.
--
-- ON DELETE SET NULL, deliberately: deleting a workspace must not delete the
-- notes and folders that were made in it. They fall back to belonging to the
-- project, which is exactly what a null board_id already means.
alter table canvas_groups
  add column board_id uuid references boards(id) on delete set null;
alter table canvas_annotations
  add column board_id uuid references boards(id) on delete set null;

create index canvas_groups_board_idx on canvas_groups (board_id) where board_id is not null;
create index canvas_annotations_board_idx on canvas_annotations (board_id) where board_id is not null;

comment on column canvas_groups.board_id is
  'The Workspace this folder/artboard was made in (ADR 0044); null = the project canvas.';
comment on column canvas_annotations.board_id is
  'The Workspace this note was made in (ADR 0044); null = the project canvas.';

-- init.sql:318 note — repeat grants for newly created tables (RLS scopes rows on top).
grant all on table boards, board_assets to authenticated, service_role;

-- ============ RLS: mirrors canvas_groups / project_assets ============
alter table boards enable row level security;
create policy boards_select on boards for select
  using (is_member(workspace_id));
create policy boards_insert on boards for insert
  with check (is_editor(workspace_id));
create policy boards_update on boards for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
create policy boards_delete on boards for delete
  using (is_editor(workspace_id));

-- board_assets carries no workspace_id → authorize through the board's
-- workspace AND the asset's, the same pair canvas_group_assets uses. Without
-- the asset half, a member of workspace A could link workspace B's asset.
alter table board_assets enable row level security;
create policy board_assets_select on board_assets for select
  using (exists (select 1 from boards b
                 where b.id = board_id and is_member(b.workspace_id)));
create policy board_assets_insert on board_assets for insert
  with check (is_editor_of_asset(asset_id)
              and exists (select 1 from boards b
                          where b.id = board_id and is_editor(b.workspace_id)));
create policy board_assets_update on board_assets for update
  using (exists (select 1 from boards b
                 where b.id = board_id and is_editor(b.workspace_id)))
  with check (exists (select 1 from boards b
                      where b.id = board_id and is_editor(b.workspace_id)));
create policy board_assets_delete on board_assets for delete
  using (exists (select 1 from boards b
                 where b.id = board_id and is_editor(b.workspace_id)));
