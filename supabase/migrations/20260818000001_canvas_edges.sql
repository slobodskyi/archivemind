-- Canvas edges — ADR 0048. User-drawn connections on the Workspace canvas:
-- photo↔photo ("thread" — the author's narrative order) and note↔photo (the
-- note becomes that photo's author context in content generation, ADR 0045 as
-- amended).
--
-- WHY THIS IS A TABLE AND NOT canvas_annotations ROWS: an edge is a RELATION,
-- not an annotation. canvas_annotations exists because a note's geometry IS its
-- content (ADR 0041); an edge has NO geometry at all — its endpoints are
-- references, and its on-screen path is derived at render time from wherever
-- the endpoints currently are (a tile's per-user localStorage override, a
-- note's server-held x/y). Parking it in the annotations table would mean
-- dummy not-null coordinates and jsonb endpoint ids that no FK can cascade.
--
-- Endpoints are TWO NULLABLE FKs PER SIDE rather than a (kind, id) pair:
-- Postgres has no polymorphic FKs, and the cascades are the point — deleting a
-- photo (purge) or a note must take its edges with it, silently. The CHECKs
-- keep each side exactly one of the two. The API and client see a flat
-- { kind, id } endpoint; only lib/edges.ts knows this shape.
create table canvas_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  -- CASCADE, deliberately opposite to canvas_annotations.board_id SET NULL: a
  -- note survives its Workspace because it has meaning on the project canvas;
  -- an edge is only a statement inside one Workspace (it feeds that board's
  -- threads and generation context). Boards soft-delete (deleted_at + the
  -- 30-day sweep), so this FK fires only at sweep_trashed_boards() time —
  -- edges survive the trash window and a restore is whole.
  board_id uuid not null references boards(id) on delete cascade,

  from_asset_id uuid references assets(id) on delete cascade,
  from_annotation_id uuid references canvas_annotations(id) on delete cascade,
  to_asset_id uuid references assets(id) on delete cascade,
  to_annotation_id uuid references canvas_annotations(id) on delete cascade,

  created_by uuid references profiles(id),
  -- No updated_at and no trigger: an edge is IMMUTABLE. You draw it or you
  -- delete it — there is nothing about a relation between two ids to edit, and
  -- an un-editable row needs no update policy either (see below).
  created_at timestamptz not null default now(),

  constraint canvas_edges_from_one check (num_nonnulls(from_asset_id, from_annotation_id) = 1),
  constraint canvas_edges_to_one check (num_nonnulls(to_asset_id, to_annotation_id) = 1),
  -- Each side has exactly one non-null, so coalesce IS the endpoint id.
  constraint canvas_edges_no_self_loop check (
    coalesce(from_asset_id, from_annotation_id) <> coalesce(to_asset_id, to_annotation_id))
);

comment on table canvas_edges is
  'User-drawn connections between canvas objects inside one Workspace (ADR 0048). An edge stores references only — its path is derived at render time — and is immutable: drawn or deleted, never edited. photo↔photo chains become authored threads; note↔photo wires feed generation context.';

-- The drag stores its direction (from → to) because thread ordering prefers
-- it, but a PAIR exists once per board regardless of which way it was drawn —
-- the reversed duplicate is the same statement.
create unique index canvas_edges_pair_uniq on canvas_edges (
  board_id,
  least(coalesce(from_asset_id, from_annotation_id), coalesce(to_asset_id, to_annotation_id)),
  greatest(coalesce(from_asset_id, from_annotation_id), coalesce(to_asset_id, to_annotation_id))
);

create index canvas_edges_ws_project_idx on canvas_edges (workspace_id, project_id);
create index canvas_edges_board_idx on canvas_edges (board_id);
-- FK referencing columns are not auto-indexed; without these every asset
-- hard-delete (the purge sweep) and note delete seq-scans this table. Partial,
-- because each column is null on half the rows by construction.
create index canvas_edges_from_asset_idx on canvas_edges (from_asset_id) where from_asset_id is not null;
create index canvas_edges_to_asset_idx on canvas_edges (to_asset_id) where to_asset_id is not null;
create index canvas_edges_from_annotation_idx on canvas_edges (from_annotation_id) where from_annotation_id is not null;
create index canvas_edges_to_annotation_idx on canvas_edges (to_annotation_id) where to_annotation_id is not null;

-- init.sql:318 note — the blanket grant only covered tables that existed then.
grant all on table canvas_edges to authenticated, service_role;

-- ============ RLS: house template + endpoint pair-checks ============
-- Tenancy is the row's workspace_id; the INSERT check additionally proves
-- every id the row points at is the caller's to point at (the board_assets
-- precedent: without the asset half, a member of workspace A could wire
-- workspace B's asset into A's board).
--
-- What RLS deliberately does NOT prove: that the endpoints are MEMBERS of
-- board_id's board (an asset in board_assets, a note with that board_id).
-- Cross-row coherence like that needs a trigger, not a CHECK — the API route
-- validates it instead and answers one undifferentiated 404. RLS guarantees
-- tenancy; the route guarantees board coherence.
alter table canvas_edges enable row level security;
create policy canvas_edges_select on canvas_edges for select
  using (is_member(workspace_id));
create policy canvas_edges_insert on canvas_edges for insert
  with check (
    is_editor(workspace_id)
    -- ties board_id to the row's own workspace, so an edge cannot be filed
    -- under a foreign board
    and exists (select 1 from boards b
                where b.id = board_id and b.workspace_id = canvas_edges.workspace_id
                  and is_editor(b.workspace_id))
    and (from_asset_id is null or is_editor_of_asset(from_asset_id))
    and (to_asset_id is null or is_editor_of_asset(to_asset_id))
    and (from_annotation_id is null or exists
         (select 1 from canvas_annotations a
           where a.id = from_annotation_id and is_editor(a.workspace_id)))
    and (to_annotation_id is null or exists
         (select 1 from canvas_annotations a
           where a.id = to_annotation_id and is_editor(a.workspace_id)))
  );
-- NO update policy, on purpose: immutability enforced as default-deny.
create policy canvas_edges_delete on canvas_edges for delete
  using (is_editor(workspace_id));
