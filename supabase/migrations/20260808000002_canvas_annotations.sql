-- Canvas annotations — ADR 0041. Sticky notes today, freehand ink next.
--
-- WHY THIS IS ON THE SERVER AT ALL, when ADR 0022 deliberately kept the canvas
-- arrangement in localStorage and ADR 0034 restated the split as "membership is
-- data, geometry is a per-user override": because an annotation is the one
-- canvas object whose geometry is NOT a preference.
--
--   A photo exists independently of the canvas. Its tile position is one user's
--   view onto a thing that is already there — which is why two people can hold
--   different arrangements of the same archive without either being wrong, and
--   why a re-cluster is free to move it.
--
--   An annotation exists nowhere else. Its position IS its content. A note at no
--   particular place is not a note; a circle drawn around nothing is not an
--   annotation. There is no second copy for the coordinates to be a preference
--   about.
--
-- So this table carries x/y/w/h, and NOTHING else about canvas layout moves.
-- Tile overrides, frames and folder geometry stay exactly where 0022 and 0034
-- put them.
--
-- What was actually broken: a sticky note was invisible to the other member of
-- the workspace, gone on a cache clear, and absent on the iPad you opened the
-- same archive on — alone among every other authored thing here (projects,
-- folders, artboards, captions, confirmed facts, colour labels). And the
-- localStorage save is a bare `catch {}` over a ~5 MB origin budget shared with
-- every project's drag overrides, i.e. a silent-loss path. Survivable for
-- coordinates that can be re-dragged; not for text a person wrote.

-- 'ink' has NO writer yet and that is deliberate. Freehand ink is the feature
-- this table exists for — five seconds of Apple Pencil at 120 Hz is ~600
-- samples (~20 KB of JSON) and a hundred strokes is ~2 MB, so it could never
-- have lived in the localStorage blob. Migrations here are append-only and
-- owner-gated (CONTRIBUTING.md), so one unused enum value costs far less than
-- discovering the shape after the fact.
create type canvas_annotation_kind as enum ('note', 'ink');

create table canvas_annotations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- null = the workspace-wide 'all' canvas; else the project. Same scoping as
  -- canvas_groups (20260723000002), so the two read the same way.
  project_id uuid references projects(id) on delete cascade,
  kind canvas_annotation_kind not null,

  -- Geometry, in Workspace-view (neural) canvas coordinates. Annotations render
  -- and are created ONLY in that view (ADR 0041 §5): the four sorting views lay
  -- the same tiles out differently, each in its own GalleryOverrides bucket, so
  -- a note positioned against one arrangement is meaningless over another. That
  -- single-view rule is also why there is no anchor column here — an annotation
  -- never follows a tile, and so can never go stale the way an ADR 0038 cloud
  -- override can.
  x double precision not null,
  y double precision not null,
  w double precision not null,
  h double precision not null,

  -- The seven macOS colours of ADR 0040, NOT a fifth palette. Sticky notes
  -- shipped with four hardcoded hexes (STICKY_NOTE_COLORS) that answered to
  -- nothing; meanwhile the workspace already has a colour vocabulary, and one
  -- the user can rename (workspace_labels). Reusing the enum means "yellow"
  -- means one thing in this product and a workspace that renamed yellow to
  -- "Client picks" gets that word on the note swatch for free.
  --
  -- Yes, the type is named for assets. That is the schema's name for *the seven
  -- colours*, and a parallel note_color enum with identical members is exactly
  -- the drift this avoids. Unlike a label there is no unset state — a note is
  -- always some colour — hence not null with a default.
  color asset_label not null default 'yellow',

  -- kind='note' → { text }; kind='ink' → { strokes }. Parsed by zod in
  -- packages/shared, never by SQL.
  body jsonb not null default '{}'::jsonb,
  -- Presentation knobs (fontSize, and whatever a note gains next). jsonb rather
  -- than a column each, the same arrangement canvas_groups.settings already has
  -- with artboardSettingsSchema — including the property that matters here: a
  -- row written before a knob existed still parses, with the default filling
  -- the gap. This is what lets the follow-up note-settings work ship as UI plus
  -- a zod field, with no second migration.
  style jsonb not null default '{}'::jsonb,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table canvas_annotations is
  'Sticky notes and (later) freehand ink on the Workspace canvas — ADR 0041. Unlike tile positions, an annotation''s geometry is its content, not a per-user view preference, which is why it lives here and the rest of the canvas arrangement stays in localStorage (ADR 0022/0034).';

-- Every read is "the annotations of this scope", which is exactly this pair.
create index canvas_annotations_ws_project_idx on canvas_annotations (workspace_id, project_id);

create trigger canvas_annotations_updated_at before update on canvas_annotations
  for each row execute function set_updated_at();

-- init.sql:318 note — the blanket grant only covered tables that existed then.
grant all on table canvas_annotations to authenticated, service_role;

-- ============ RLS: mirrors canvas_groups (20260723000002) ============
-- A viewer reads the notes (they are part of what the workspace is saying about
-- the archive); an editor writes them. Deliberately NOT author-scoped: nothing
-- else in this schema is — a folder, an artboard, a caption and a colour label
-- are all editable by any editor — and a note only one person can fix is the
-- shared-workspace problem this table was created to solve, reintroduced.
alter table canvas_annotations enable row level security;
create policy canvas_annotations_select on canvas_annotations for select
  using (is_member(workspace_id));
create policy canvas_annotations_insert on canvas_annotations for insert
  with check (is_editor(workspace_id));
create policy canvas_annotations_update on canvas_annotations for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
create policy canvas_annotations_delete on canvas_annotations for delete
  using (is_editor(workspace_id));
