# 0042 — Editable Topic clouds preserve the AI answer underneath human curation

## Status

Accepted — 2026-08-10.

Amends [0028](0028-topic-clusters-from-embedding-kmeans.md) (cluster storage and
worker lifecycle) and [0038](0038-topic-view-legibility.md) (Topic identity and
the meaning of Re-cluster). The embedding model, deterministic spherical
k-means, tag-derived machine labels, and zero-credit property all stand.

## Context

Topic already has two superficially similar drags with different meanings.
Dragging a tile through empty canvas space arranges a view and persists a
per-project coordinate override. Moving a photo from “Travel” to “Family” is a
workspace-wide statement about what the photo belongs with. Treating both as
coordinates would make membership accidental; writing both into
`assets.cluster_id` would make the next worker run erase a human decision.

`assets.cluster_id` is not just a grouping field. It is the latest k-means
answer, and `topic_clusters.centroid` is the stability anchor by which a later
run reuses that answer's id. Replacing either with a manual move would mix two
authors in one field and make “Return to AI” impossible: the machine answer
would already be gone.

The reverse design — feeding every drag back into k-means — is also wrong for
the first version. One deliberately exceptional photo can shift a centroid and
silently move unrelated photos. A manual category can be conceptual (“client
picks”), not a compact region of embedding space at all. Vectors should help a
person find candidates later; they should not reinterpret an explicit move in
the background.

## Decision

### The effective topic is a precedence rule, not a rewritten cluster

The three grouping sources remain distinct:

```text
effective topic = manual override ?? AI cluster ?? tag heuristic / Unsorted
```

`assets.cluster_id` remains the worker-owned AI baseline. A new
`topic_cluster_overrides` row stores one human assignment per asset. Deleting
that row is **Return to AI** and reveals whatever baseline the latest
Re-cluster produced; no reconstruction and no second model call are needed.

Assignments are workspace-wide. A photo has one effective Topic everywhere it
appears, while its tile coordinates remain project-local canvas preferences.
If one photo must belong to several arbitrary sets, that is a future collection
or the existing tag/project model, not a single packed Topic tile.

### A stored topic has an author

`topic_clusters.origin` is `generated | manual`:

- a generated row has a non-null 768-dimensional centroid and continues through
  deterministic matching, relabelling and pruning;
- a manual row has a null centroid and `is_renamed=true`. It is never an input
  to worker matching and the worker never updates or deletes it.

The database CHECK pins that distinction. A human pile does not receive the
mean embedding of its current members and masquerade as a machine result.
`topic_clusters.size` keeps its baseline-membership meaning for generated rows;
for manual rows a trigger maintains the live override count.

Cloud identity is the stable topic id, never its display label. This completes
the direction begun by ADR 0038, where drag staleness already anchored on
cluster id: two topics may share a visible name without merging, and a rename
changes no membership, colour identity or arrangement.

### Manual decisions constrain the worker's lifecycle, not its mathematics

The worker selects only `origin='generated' AND centroid IS NOT NULL` for
stability matching. Inserts and updates state `origin='generated'` explicitly.
Manual rows therefore cannot be matched, machine-labelled, emptied or pruned by
accident.

A generated row referenced by an override is protected too. If a new k-means
run no longer matches it, the worker retains the row with machine `size=0`
instead of deleting it. The override FK is `ON DELETE RESTRICT`, so even a
future worker bug that misses the guard fails the transaction rather than
silently erasing the manual assignment. This applies in the normal unmatched
path and when the corpus falls below `MIN_CLUSTER_ASSETS`.

Every Topic mutation takes the same workspace advisory transaction lock as the
cluster handler. The lock closes the race in which the worker plans to delete a
generated row while a user is dropping photos into it. Delete SQL repeats a
`NOT EXISTS (topic_cluster_overrides)` predicate as defence in depth and
re-checks `is_renamed=false`, so a concurrent rename cannot pin a label just
before the worker deletes that row.

Re-cluster therefore means: **refresh the AI baseline while preserving every
manual assignment and manual topic**. It still costs zero credits and makes no
Gemini call.

### Mutations are bulk, atomic, and workspace-resolved

The client never writes either table directly. The migration grants
authenticated users SELECT on `topic_cluster_overrides` and exposes three
narrow SECURITY DEFINER RPCs; each checks `is_editor`, validates that every
asset and target belongs to the server-resolved workspace, caps a selection at
500, and changes all rows in one transaction:

- `create_manual_topic(workspace, label, assets)` creates the row and seeds all
  assignments together;
- `assign_topic_assets(workspace, assets, cluster|null)` moves a batch, or
  deletes their overrides when the target is null;
- `delete_manual_topic(workspace, cluster)` deletes only `origin='manual'` and
  explicitly removes that topic's overrides before the row, returning every
  member to its AI baseline in the same transaction.

The matching HTTP surface is:

- `GET /api/topics` → every non-empty or protected workspace destination,
  independent of the currently-open project's asset subset;
- `POST /api/topics` `{label, assetIds}` →
  `{topic:{id,label}}`;
- `PUT /api/topics/assignments` `{assetIds, clusterId|null}` → `{ok:true}`;
- `DELETE /api/topics/:id` → `{ok:true}` for a manual topic only.

`workspaceId` appears in none of those request bodies. Route handlers derive it
from the caller's current membership, then the RPC independently authorizes it.
RLS scopes reads; the SECURITY DEFINER checks are the write boundary.

### Interaction semantics stay explicit

A normal tile drag through empty space continues to mean spatial arrangement.
Membership changes only through an explicit cloud drop target or the equivalent
Move-to-topic menu. Creating a cloud starts from a non-empty selection; empty
clouds have no useful canvas geometry and accumulate unexplained clutter.
Only a persisted cluster is a drop target. A heuristic cloud has no durable id,
and materialising all of its members would change unselected files; use **New
topic from selection** instead. A cancelled pointer gesture never writes
membership.

After a move, the tile is repacked into the destination cloud rather than left
at the pointer coordinate. The existing Topic coordinate override is cleared or
invalidated by its cloud-id anchor, so a semantic move cannot stretch the new
cloud across the canvas. Bulk moves are one optimistic outcome with Undo; undo
replays the previous effective destinations, not a blanket reset.

## Consequences

- A user decision survives analyze, Re-cluster, rename, project switches and
  sessions, while Return to AI always exposes a current machine answer.
- Manual topics can express useful concepts that are not geometrically compact
  in embedding space. This flexibility is intentional; their centroid is null.
- The Topic read now needs both `assets.cluster_id` (baseline) and the optional
  override target (effective assignment), plus the target's id/label/origin.
- Generated clusters with manual references may remain as `size=0` baseline
  rows. They are not leaks: each is reachable through live effective members
  and becomes deletable as soon as those overrides move/reset.
- Soft trash preserves the override so Restore is lossless. Permanent purge
  explicitly deletes it because the asset row remains as a dedup tombstone and
  will never trigger the override's asset FK cascade; this also releases a
  protected generated destination and decrements a manual topic's live size.
- Deleting a manual topic is reversible only through the client's Undo payload;
  the database correctly removes its assignments and falls back to AI rather
  than inventing a replacement manual row.
- No `usage_events` row is written. These operations run no model and therefore
  cost zero credits under ADR 0037.
- A later **Find similar / Grow topic** action may average selected embeddings,
  rank candidates by cosine similarity and ask for confirmation. It must remain
  an explicit previewed action; this ADR does not authorize automatic centroid
  feedback or constrained k-means.
