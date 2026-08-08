-- Colour labels — the human curation axis, next to (never inside) the AI one.
--
-- WHY NOT `tags`: that table is the analyze handler's output and it is load
-- bearing three times over — Topic clouds fall back to a tag heuristic when an
-- asset has no cluster (ADR 0023), the connecting-line web is literally shared
-- tags (ADR 0022), and search_assets() ranks a tag hit into the explicit tier
-- (ADR 0029/0031). A row named 'red' in there would grow a "red" cloud, wire
-- every marked photo to every other one, and surface on a text search for the
-- colour. The two axes also have different owners: the model writes tags, only
-- a person writes a label.
--
-- ONE label per asset, so it is a column and not a join table. The canvas is
-- made of physical tiles: a tile occupies exactly one position in exactly one
-- cloud, so the LABELS view has to be able to ask a photo for *the* label it
-- groups under. macOS Tags are multi-valued and dodge this because a Finder
-- list row can carry several dots and still sort by the first one; a packed
-- cloud canvas cannot. Single-valued is also the photo-tool norm (Lightroom,
-- Capture One, Bridge — and the classic pre-10.9 Finder label this is named
-- after). Multi is a later `asset_labels` table if it is ever wanted; nothing
-- here forecloses it.
--
-- The seven values ARE the macOS set, in macOS order — this is a feature people
-- already know, and re-picking the palette would only make it read as almost-
-- but-not-quite the thing they expected.
create type asset_label as enum ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray');

alter table assets add column label asset_label;

comment on column assets.label is
  'User-assigned colour label (macOS Finder / Lightroom style), null = unlabelled. Human curation only — the worker never writes it and no AI job reads it, which is exactly why it is not a tag. Single-valued: the LABELS view packs one tile into one cloud.';

-- Partial: the filter and the LABELS view only ever ask for labelled rows, and
-- most of an archive is unlabelled, so the null majority stays out of the index.
create index assets_workspace_label_idx on assets (workspace_id, label) where label is not null;

-- No new policy and no column ACL: assets_update (init.sql:374) already grants
-- editors UPDATE on their workspace's assets — it is how the soft delete in
-- POST /api/assets/delete runs as the caller — so a label write is already
-- covered by the same gate, and a viewer is already refused by it.

-- ── renaming a colour ────────────────────────────────────────────────────────
-- A colour means nothing on its own; the workflow is "red = rejected, green =
-- client picked". So the seven names are renameable, workspace-wide, and only
-- the overridden ones exist as rows — the defaults live in packages/shared and
-- need no seeding, which also means every workspace that predates this
-- migration is already correct with zero rows.
--
-- Same shape as the Topic-cloud rename (ADR 0038): a pinned human name wins
-- over the generated default, forever. Unlike topic_clusters there is no
-- is_renamed flag, because the existence of the row IS the flag — nothing
-- regenerates these names.
create table workspace_labels (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  label asset_label not null,
  name text not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, label)
);

comment on table workspace_labels is
  'Per-workspace display name for a colour label. Only renamed colours have a row; the defaults are DEFAULT_LABEL_NAMES in packages/shared. Deleting a row restores the default.';

-- init.sql:318 note — the blanket grant only covered tables that existed then.
grant all on table workspace_labels to authenticated, service_role;

alter table workspace_labels enable row level security;
-- Read by any member (a viewer must see "Client picks" too, or the label strip
-- reads as a row of anonymous dots); written by editors, like every other
-- workspace-wide name in this schema.
create policy workspace_labels_select on workspace_labels for select
  using (is_member(workspace_id));
create policy workspace_labels_insert on workspace_labels for insert
  with check (is_editor(workspace_id));
create policy workspace_labels_update on workspace_labels for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
create policy workspace_labels_delete on workspace_labels for delete
  using (is_editor(workspace_id));
