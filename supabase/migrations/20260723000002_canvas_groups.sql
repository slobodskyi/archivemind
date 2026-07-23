-- Canvas groups (folders + artboards) — ADR 0034. Two on-canvas grouping
-- primitives share ONE server model, discriminated by `kind`:
--   • folder   — organize/tidy the pile; collapses N tiles into one. A file
--                lives in at most one folder per scope — enforced in the route,
--                NOT the DB, because artboards deliberately share assets, so a
--                blanket unique index on asset_id would be wrong.
--   • artboard — compose a deliverable; its ordered members become the pages of
--                a PDF export (ai_jobs type='export', already in the enum since
--                init — ADR 0035).
--
-- MEMBERSHIP + name + order + export settings are DATA and live here (exactly
-- like project_assets). The on-canvas GEOMETRY (x/y/w/h, collapsed) stays a
-- per-user client override in localStorage, so this does NOT move canvas layout
-- onto the server — ADR 0022 holds, positions are still client-only.
--
-- Scope: project_id null = the workspace-wide ('all') canvas; else the project.
-- A group is a curated SUBSET, not a container of bytes: deleting it cascades
-- the membership rows only; the assets themselves survive (same as projects).

create type canvas_group_kind as enum ('folder', 'artboard');

create table canvas_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id   uuid references projects(id) on delete cascade,   -- null = 'all' canvas
  kind canvas_group_kind not null,
  name text not null,
  sort_index int not null default 0,             -- artboard order → PDF page order
  settings jsonb not null default '{}'::jsonb,   -- artboardSettingsSchema (packages/shared); {} for folders
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index canvas_groups_ws_project_idx on canvas_groups (workspace_id, project_id);

create table canvas_group_assets (
  group_id uuid not null references canvas_groups(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  position int not null default 0,               -- order within the group (= PDF page order)
  added_by uuid references profiles(id),
  added_at timestamptz default now(),
  primary key (group_id, asset_id)
);
create index canvas_group_assets_asset_idx on canvas_group_assets (asset_id);

create trigger canvas_groups_updated_at before update on canvas_groups
  for each row execute function set_updated_at();

-- init.sql:318 note — repeat grants for newly created tables (RLS scopes rows on top).
grant all on table canvas_groups, canvas_group_assets to authenticated, service_role;

-- ============ RLS: mirrors projects / project_assets (init.sql:395-414) ============
alter table canvas_groups enable row level security;
create policy canvas_groups_select on canvas_groups for select
  using (is_member(workspace_id));
create policy canvas_groups_insert on canvas_groups for insert
  with check (is_editor(workspace_id));
create policy canvas_groups_update on canvas_groups for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
create policy canvas_groups_delete on canvas_groups for delete
  using (is_editor(workspace_id));

-- canvas_group_assets (M:N; carries no workspace_id → authorize via the group's
-- workspace AND the asset's workspace, exactly like project_assets).
alter table canvas_group_assets enable row level security;
create policy canvas_group_assets_select on canvas_group_assets for select
  using (exists (select 1 from canvas_groups g
                 where g.id = group_id and is_member(g.workspace_id)));
create policy canvas_group_assets_insert on canvas_group_assets for insert
  with check (is_editor_of_asset(asset_id)
              and exists (select 1 from canvas_groups g
                          where g.id = group_id and is_editor(g.workspace_id)));
create policy canvas_group_assets_update on canvas_group_assets for update
  using (exists (select 1 from canvas_groups g
                 where g.id = group_id and is_editor(g.workspace_id)))
  with check (exists (select 1 from canvas_groups g
                      where g.id = group_id and is_editor(g.workspace_id)));
create policy canvas_group_assets_delete on canvas_group_assets for delete
  using (exists (select 1 from canvas_groups g
                 where g.id = group_id and is_editor(g.workspace_id)));
