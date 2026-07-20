# 0023. Topic clouds are derived from AI tags (interim until embedding clustering)

Date: 2026-07-20

Status: Accepted

Supersedes the "Topic renders one `archive` cloud on real data" part of
[0018](0018-cloud-clusters-map-topic-default-zoom.md) /
[0022](0022-timeline-clouds-and-live-cloud-labels.md): `group` is no longer an
inert default. Map's `country` is still inert — that part of 0018 stands.

## Context

Since #74 the Topic view clusters by `photo.group`, which `lib/assets.ts`
stamped as the inert `"archive"` for every real asset — so on real data Topic
rendered exactly one cloud labeled ARCHIVE (documented as "the data, not a
bug"). After #93 the connecting lines became real shared-AI-tag relations, which
made the mismatch visible: the *lines* show real structure inside a cloud that
itself says nothing. Analyze has been live since Phase 2 and every processed
asset carries categorized tags (object / scene / place / attribute / event /
other, spec §8.2) — enough signal to name real themes.

The spec's endgame for this field is similarity clustering over embeddings
(§13, post-MVP). That needs a worker job, storage, and labeling; not this PR.

## Decision

`group` is **derived from the asset's AI tags at read time** by the pure
`deriveTopics()` in `apps/web/lib/topics.ts`, called from `getRealPhotos`:

- **Untagged (unanalyzed) assets → `Unsorted`** — consistent with 0022's "the
  web shows what AI has processed".
- An asset's topic is its most *clustering-useful* tag: walk categories in
  **event → scene → object** priority (`place` belongs to the Map view,
  `attribute` describes people not themes, `other` is too vague); within the
  first category that has any viable tag pick the one **shared with the most
  other assets**, name tie-break.
- **Ambient tags are skipped as candidates**: a tag on strictly more than
  `TOPIC_AMBIENT_FRACTION` (60%) of the tagged assets names the whole archive,
  not a theme inside it (`floor`, with a floor of 2 so 2-asset archives still
  get a topic). Counting is by tag **name**, merged across categories — the
  DB's name+category key means re-analyze drift can split one conceptual tag
  into two rows, and split counts must not sneak an ambient name under the
  threshold. **Fallback:** an asset whose only thematic tags are ambient keeps
  the most-shared of them (same priority walk, ambient allowed) instead of
  falling to `Other` — so a tiny archive sharing one tag renders a cloud named
  after that tag, and never renames itself to "Other" on the third upload.
- Tagged assets with no tag in any thematic category → **`Other`**.
- Only the **`TOPIC_CLOUD_CAP` (6) biggest topics keep their name** (size desc,
  name asc), the rest fold into `Other` — keeps the canvas readable. (Cloud
  *colors* hash into the shared 6-color palette and can collide between
  clouds; the cap bounds cloud count, not color uniqueness.)
- `PhotoGroup` widens to `string`; `topicCloudColor` falls through from the
  curated mock `GROUPS` colors to the shared hash palette for arbitrary
  tag-derived keys (Unsorted keeps its gray). The derivation is deterministic
  under any row order (pure sorts, per-asset de-dup) — SSR-safe per the
  no-`Math.random` layout rule.

## Consequences

- Topic finally splits real archives into named clouds, and the tag-driven
  lines/cross-cloud bridges (0022) get meaningful clusters to bridge.
- **Topics are result-set-relative and re-derived on every read**: sharing
  counts, the ambient threshold and the top-6 fold are computed over exactly
  the rows `getRealPhotos` returned — one project's newest ≤500 assets (or the
  workspace window for "all", where Topic never renders). The same asset can
  legitimately carry different topics in different projects, and analyzing new
  photos can rename or re-split clouds. Acceptable for an exploration canvas;
  the stable version of this field is the embedding-clustering job (spec §13),
  which replaces this heuristic wholesale — `deriveTopics` is deliberately a
  single seam to swap out.
- Topic drag overrides (`galleryOverrides.topic`) key on asset ids, not cloud
  keys, so re-derived topics move the *packed defaults* while user drags stay
  where they were dropped. Known wart: because the label/backdrop track live
  positions (0022), a dragged tile whose topic later changes stays at its old
  coordinates as a member of the *new* cloud — stretching that cloud's
  backdrop/label toward it until the user re-drags it (or the versioned canvas
  store is bumped). Cheap future fix if it bites: store the cloud key beside
  the override and drop it when the derived topic differs.
- The `GROUPS` lookup table's remaining consumers are `lib/layout.ts`
  (`topicCloudColor`'s curated-color fallthrough and the Topic label lookup —
  both only ever hit for mock seed keys now) and mock-data's own `GROUP_LIST`
  — one step closer to retiring the `lib/mock-data.ts` debt imports.
