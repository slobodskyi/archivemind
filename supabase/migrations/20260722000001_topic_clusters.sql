-- Semantic Topic clusters (spec §10/§13, ADR 0028): stored clusters computed
-- by the worker's k-means job over image embeddings, replacing the read-time
-- tag heuristic (ADR 0023) as the primary source of a photo's Topic cloud.
-- The heuristic stays as the fallback for not-yet-clustered assets, so this
-- migration only ADDS storage — nothing existing changes shape.

-- The worker enqueues a 'cluster' job at the tail of every analyze run. Append
-- to the job_type enum; this value is NOT used elsewhere in this migration, so
-- it is safe even if the file runs inside a transaction (Postgres forbids
-- USING a freshly added enum value in the same txn, not adding it).
alter type job_type add value if not exists 'cluster';

-- One semantic cluster per workspace-run. Stable across sessions and identical
-- in every project of the workspace (unlike the result-set-relative heuristic).
-- centroid is the mean unit vector the worker matches against on the next run
-- to keep ids/labels stable (greedy cosine matching, ADR 0028).
create table topic_clusters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  label text not null,
  size int not null default 0,
  centroid vector(768) not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index topic_clusters_ws_idx on topic_clusters (workspace_id);

-- An asset's stored cluster. NULL = not yet clustered (or its cluster was
-- pruned) → the web read path falls back to the tag heuristic. ON DELETE SET
-- NULL so pruning a cluster (corpus shrank below the k-means floor, or the
-- cluster merged away) cleanly drops its members back to the heuristic.
alter table assets add column cluster_id uuid references topic_clusters(id) on delete set null;
create index assets_cluster_idx on assets (cluster_id);

create trigger topic_clusters_updated_at before update on topic_clusters
  for each row execute function set_updated_at();

-- init.sql:318 "repeat grants for newly created tables" — the bulk grant there
-- only covered tables that existed then. RLS scopes rows on top of these.
grant all on table topic_clusters to authenticated, service_role;

-- Members read their workspace's clusters (the embedded label join in
-- lib/assets.ts). No insert/update/delete policy: the worker writes as the
-- `postgres` role and bypasses RLS — same custody model as `embeddings`.
alter table topic_clusters enable row level security;
create policy topic_clusters_select on topic_clusters for select using (is_member(workspace_id));
