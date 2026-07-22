# 0028. Topic clouds cluster by embedding k-means, stored per workspace

Date: 2026-07-22

Status: Accepted

Supersedes in part [0023](0023-topic-clouds-derived-from-tags.md): the tag
heuristic is now the *fallback*, not the primary source, of a photo's Topic
cloud. The tag-driven connecting lines (0022) and the Timeline date axis (0024)
are untouched.

## Context

ADR 0023 derives each asset's Topic cloud from its AI tags at read time, and
says so explicitly as an interim: *"the stable version of this field is the
embedding-clustering job (spec §13), which replaces this heuristic wholesale —
`deriveTopics` is deliberately a single seam to swap out."* That heuristic has
two structural limits it can never shake:

- It groups by **exact tag-name match**. "yoga", "stretching" and "йога" are
  three clouds even though they are one theme — the heuristic has no notion of
  meaning, only string identity.
- It is **result-set-relative**: sharing counts, the ambient threshold and the
  top-6 fold run over exactly the ≤500 rows a read returned, so the same asset
  carries different topics in different projects and clouds rename themselves as
  the corpus grows.

The spec's endgame (§10, §13) is k-means over the image embeddings the analyze
job already stores — server-provided cluster ids, computed once and reused. The
embeddings exist (`embeddings.embedding vector(768)`, `kind='image'`); what was
missing was a worker job, storage, and labeling.

## Decision

A new worker job **`cluster`** (added to the `job_type` enum) re-clusters a
workspace's analyzed assets and stores the result:

- **Schema** (migration `20260722000001`): `topic_clusters (id, workspace_id,
  label, size, centroid vector(768), created_at, updated_at)` and
  `assets.cluster_id uuid null references topic_clusters(id) on delete set
  null`. RLS: members SELECT their workspace's clusters; there is **no** write
  policy — the worker writes as the `postgres` role, the same custody model as
  `embeddings`.
- **Algorithm** (`apps/worker/src/services/cluster-logic.ts`, pure + unit
  tested): deterministic spherical k-means. Inputs are sorted by asset id, so
  the result is invariant to DB row order; the only randomness is a `mulberry32`
  PRNG seeded from the workspace id (no `Math.random`, no wall clock —
  reproducible like every other layout path). `k = clamp(round(sqrt(n/2)), 2,
  12)`; below `n = 8` analyzed assets we do not cluster at all (the heuristic
  covers small corpora fine).
- **Labels come from tags, not Gemini**: a cluster is named by its two most
  *discriminative* tag names (TF ratio = cluster doc-frequency / workspace
  doc-frequency), thematic categories (event/scene/object) preferred, joined
  with `" · "`. An in-run uniqueness pass widens to a third tag, then a numeric
  suffix, so two clusters never collapse into one cloud (which keys on the label
  string). No paid call is involved — the tags are already there.
- **Stability across runs**: before writing, new centroids are greedily matched
  to existing clusters by cosine similarity (threshold 0.9). A matched cluster
  keeps its **id and label** (only centroid/size/membership refresh), so clouds
  don't rename themselves every run; unmatched new clusters are inserted,
  unmatched old ones deleted (the FK nulls their members back to the heuristic).
  If the corpus shrinks below the floor, all clusters are deleted and the
  heuristic takes over cleanly.
- **Trigger**: the job is enqueued automatically at the tail of every `analyze`
  run that produced new embeddings (worker-side raw insert, guarded by
  `analyzed > 0` so a run that analyzed nothing — e.g. every asset lacked a
  medium preview — enqueues nothing, and deduped against an already-queued
  cluster job). It is **not** in `createJobRequestSchema` — there is no web
  enqueue path.
- **Read path** (`lib/topics.ts`, the ADR 0023 seam): an asset's topic is its
  stored `topic_clusters.label` when present, else the tag heuristic, else
  Unsorted (untagged and unclustered). Cluster labels and heuristic topics fold
  together through the existing top-6 + Other cap. `Photo`, the cloud layout,
  and `topicCloudColor` (hash palette) are unchanged — the cloud key is still a
  plain string.

**On the "AI only by button" rule.** The 2026-07-10 product decision keeps every
*paid* Gemini call behind an explicit user action. The cluster job makes **zero**
Gemini calls — it is pure CPU over vectors that already exist — so auto-enqueuing
it after analyze does not spend the user's money and does not violate that rule.
It is invisible in the UI by construction: `useWorkspace` acts only on `ingest`
jobs and on the one job id the user's own action is tracking, and drops every
other `ai_jobs` broadcast.

## Consequences

- Topics are finally **stable across sessions and identical in every project**
  of a workspace — the same asset lands in the same cloud everywhere, and
  semantically-related tags ("yoga"/"stretching"/"йога") merge into one cloud
  instead of three.
- The tag heuristic (0023) is not gone — it is the fallback for the window
  between "analyzed" and "clustered" (a just-uploaded batch, or an asset added
  after the last cluster run), and for workspaces under the 8-asset floor. Both
  paths produce the same shape of `group: string`, so the canvas can't tell
  them apart.
- Clustering runs over the **whole workspace**, not the read's ≤500-row window —
  that is the point (stability across projects), and it is why the job is
  workspace-scoped, not asset-scoped. For MVP corpus sizes the in-memory k-means
  is a sub-second background pass; if a workspace grows to tens of thousands of
  analyzed assets this becomes the first place to add sampling.
- Concurrent cluster runs for one workspace are serialized by a `for update`
  lock on `topic_clusters` inside the job's single transaction; the deterministic
  logic makes the last commit idempotent.
- During a worker deploy, an old worker that claims a `cluster` job throws in
  `claimNextJob`'s `jobTypeSchema.parse` — caught by the poll loop, the row sits
  `running` until the 15-minute reaper requeues it for a new worker. Harmless,
  but push the worker before triggering analyze on prod.
- The web build's `ASSET_SELECT` now references `topic_clusters`, so the prod
  migration must land **with or before** the web deploy (see the rollout note in
  the PR / runbook), or `getRealPhotos` throws against an un-migrated database.
