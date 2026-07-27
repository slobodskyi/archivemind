-- User-renameable Topic cloud labels (ADR 0038).
--
-- ADR 0028 names every cluster after its two most discriminative tags. That is
-- good enough to navigate by and never the name the archive's owner would have
-- chosen — "screenshot · smartphone" describes the medium, not the theme. So a
-- cloud's name becomes the user's write: renaming is curation, not AI output.
--
-- But the same row also holds `centroid`, the k-means stability anchor the
-- worker matches against on every run (ADR 0028). A forged centroid does not
-- corrupt one row — it silently corrupts every future clustering of the whole
-- workspace, and `size` feeds the label heuristic. That blast radius is why the
-- rename gets one more defence than the captions/facts model (route-level
-- narrowing over a blanket update policy, init.sql:433-445): an editor may
-- write `label` and `is_renamed` and NOTHING else.
--
-- The narrowing uses the revoke-then-column-grant pattern init.sql:365-368
-- already uses for the source_connections token columns (init.sql:323 asks us
-- to keep that ordering). Unlike RLS, a column ACL RAISES 42501 rather than
-- filtering rows, so a write to centroid/size/workspace_id is an error, not a
-- silent no-op. service_role and the worker's `postgres` connection are
-- untouched — the worker owns the table and is subject to neither.
--
-- No job_type change: 'cluster' has existed since 20260722000001, and
-- ai_jobs_insert (is_editor, no type restriction) already lets an editor
-- enqueue one — ADR 0038's Re-cluster button removes a zod refusal, not a
-- database boundary.

alter table topic_clusters
  add column is_renamed boolean not null default false;

comment on column topic_clusters.is_renamed is
  'True once a human named this cloud. The cluster worker must PRESERVE label on a matched cluster while this is set, and must not delete such a cluster when its centroid stops matching — otherwise the next re-cluster silently discards the rename (ADR 0038).';

-- ── narrow the table-level UPDATE grant from 20260722000001 to two columns ────
-- Revoke UPDATE only; SELECT/INSERT/DELETE stay as granted (RLS already denies
-- the write verbs by having no policy for them). `updated_at` is deliberately
-- NOT in the grant list — the BEFORE UPDATE trigger sets it, and Postgres
-- checks column privileges against the statement's SET list, not against
-- columns a trigger mutates, so a client can neither backdate nor freeze it.
revoke update on table topic_clusters from authenticated;
grant update (label, is_renamed) on table topic_clusters to authenticated;

-- ── the row gate: editors of the workspace, as with projects/canvas_groups ────
-- Rows still need a policy or the UPDATE affects zero rows. `workspace_id` is
-- not column-grantable, so a cluster cannot be moved between workspaces; the
-- WITH CHECK is belt-and-braces for the day someone widens the grant.
create policy topic_clusters_update on topic_clusters for update
  using (is_editor(workspace_id)) with check (is_editor(workspace_id));
