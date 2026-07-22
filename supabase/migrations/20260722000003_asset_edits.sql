-- Non-destructive image editing (ADR 0030): a Tier-0 edit (crop / rotate90 /
-- straighten / flip) is stored as a resolution-independent RECIPE plus the R2
-- keys of freshly rendered edited previews. asset_previews (the originals) are
-- NEVER overwritten, so a reset is just dropping the row here — instant, free,
-- and identical for every source (upload/gdrive/dropbox): the worker renders
-- from the asset's ORIGINAL medium preview, which R2 already holds, so no
-- original bytes and no source-specific path are involved (the ADR 0025
-- "Drive originals never in R2" invariant is untouched).

-- The worker runs the render as an 'edit' job, enqueued by the dedicated
-- POST /api/assets/[id]/edit route. Append to the job_type enum; this value is
-- NOT used elsewhere in this migration, so it is safe inside a transaction
-- (Postgres forbids USING a freshly added enum value in the same txn, not
-- adding it) — same pattern as 'cluster' in 20260722000001.
alter type job_type add value if not exists 'edit';

-- One edit per asset (the current state). recipe is the source of truth; the
-- edited_*_key columns are the worker's rendered thumb/medium in R2 under
-- {workspace_id}/edits/{asset_id}/{size}.webp. The read path prefers these keys
-- over asset_previews when a row exists, so every view shows the edit.
create table asset_edits (
  asset_id uuid primary key references assets(id) on delete cascade,
  recipe jsonb not null,
  edited_thumb_key text,
  edited_medium_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger asset_edits_updated_at before update on asset_edits
  for each row execute function set_updated_at();

-- init.sql:318 "repeat grants for newly created tables" — the bulk grant there
-- only covered tables that existed then. RLS scopes rows on top of these.
grant all on table asset_edits to authenticated, service_role;

-- Members READ their asset's edit (the read-path join + the editor's "load
-- current recipe"). Editors may DELETE it (the reset action, done straight from
-- the web with no worker round-trip). INSERT/UPDATE are worker-only: the worker
-- writes as the `postgres` role and bypasses RLS (same custody model as
-- asset_previews / topic_clusters / embeddings), so no write policy is granted
-- to authenticated — the only first-party write is the reset DELETE below.
alter table asset_edits enable row level security;
create policy asset_edits_select on asset_edits for select
  using (is_member_of_asset(asset_id));
create policy asset_edits_delete on asset_edits for delete
  using (is_editor_of_asset(asset_id));
