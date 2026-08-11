# 0038. Topic clouds hold together: anchored overrides, honest names, a way back

Date: 2026-07-27

Status: Accepted

Amends [0022](0022-timeline-clouds-and-live-cloud-labels.md) (the live label /
backdrop anchor), [0023](0023-topic-clouds-derived-from-tags.md) (the top-6
"Other" fold, and the "cheap future fix" its Consequences section already
named), [0024](0024-timeline-date-axis-cloud-focus.md) (cloud drag gains a way
back) and [0028](0028-topic-clusters-from-embedding-kmeans.md) (label ranking,
label stability, and the "no web enqueue path" for the `cluster` job). Nothing
here changes the Map (0027) or the Timeline axis (0024).

## Context

Topic was the view that decayed. Three separate defects, each of which we
confirmed by running the real code rather than reading it:

**1. Tiles drifted apart and cloud names floated over empty canvas.** Topic drag
overrides key on asset id and persist per project in localStorage, while a
photo's cloud is recomputed server-side after every analyze. Nothing ever
reconciled the two, and nothing ever pruned an override. ADR 0023 predicted this
verbatim — *"a dragged tile whose topic later changes stays at its old
coordinates as a member of the new cloud, stretching that cloud's
backdrop/label toward it… Cheap future fix if it bites: store the cloud key
beside the override and drop it when the derived topic differs."* It bit.
Measured on the real layout: **one** stale override stretched a cloud's bounding
box from 581 px to 1856 px and slid its label 638 px off its own tiles — because
`labelX`/`bx..bh` are derived from *all* members (0022). A second, smaller
contributor: the macro packer applied the asymptotic 0.62 packing density flat,
so a one-photo cloud reserved a circle ~3× its own area, and the Topic canvas is
full of one- and two-photo clouds.

And there was no way back. The bottom action bar that hosts "Tidy up" is gated
on `view === "neural"`, so the sorting views shipped with no layout controls at
all; `tidyUp` itself writes the `asset` bucket, so pointing it at Topic would
silently rearrange Canvas instead.

**2. The names were wrong in a specific, reproducible way.** ADR 0028 ranks
candidate tags purely by discriminativeness (`clusterDf / workspaceDf`). A tag
carried by exactly one photo scores 1/1 = 1.0, the maximum possible, and beats a
tag carried by every member. Running `labelClusters` on a 6-photo screenshot
cluster where one photo showed a book cover returned **`"smartphone · book
cover"`**. Three more failure modes rode along: `slice(0, 2)` always padded a
second tag however weak it was (an 80-photo cluster named `"street · yoga"` off
two photos); the collision breaker *appended* a third tag, so two clusters read
as `"floor · mat"` and `"floor · mat · wall"` — indistinguishable, and unbounded
in length; and medium/format words (`screenshot`, `smartphone`) arrive as
ordinary `scene`/`object` tags, so the thematic-category filter could not touch
them.

Worse, none of it was fixable in place: `planClusters` copies the stored label
onto every matched cluster and the handler's UPDATE never mentions `label` at
all. With `MATCH_THRESHOLD = 0.9` most clusters match every run, so **any**
improvement to the labeller would have been invisible on every existing
workspace.

**3. There was no escape hatch.** A user could not rename a cloud (no policy, no
route, no UI) and could not ask for a re-cluster (the job type is deliberately
absent from `createJobRequestSchema`), so after adding or deleting photos the
only way to refresh the clouds was to pay for an analyze they did not want.

## Decision

### Overrides belong to a cloud, and the label belongs to the core

- A Topic override records the cloud it was dropped in: `CanvasOverride`
  extends `CanvasPoint` with an optional `cloud`. The layout honours an override
  only while that anchor still matches — otherwise the tile re-packs with its
  new cloud. The anchor is the **stored cluster id** (`Photo.clusterId`, newly
  surfaced from a column `ASSET_SELECT` already fetched), falling back to the
  derived topic key. Anchoring on the id and not the label is what lets a
  relabel *and* a rename leave the user's arrangement untouched.
- The field is optional and shared by all five buckets: the drag path writes
  every bucket through one computed key, and a pre-existing override simply has
  no anchor and is honoured as-is. The localStorage `v` gate is untouched —
  bumping it is all-or-nothing and would also discard artboards and sticky notes.
- The anchor is captured **once at pointer-down** into the drag session, never
  recomputed in `move()`: that handler already runs a full 500-iteration re-pack
  per pointer event.
- A cloud's label anchor and backdrop bbox are computed over its **core** —
  members within `CLOUD_CORE_SPAN` (2.2) packed radii of the cloud's *median*
  position. A median is what makes this robust: one tile flung across the canvas
  moves a mean, not a median. A whole-cloud drag moves every tile together, so
  the median moves with it and 0024's whole-cloud drag still carries the label.
  The outlier tile stays exactly where it was dropped — it just stops dragging
  the *name* with it.
- The packing density ramps with cloud size (`0.62 + 0.38/n`): exactly 1.0 for a
  singleton, converging on the old constant as the cloud grows.

### "Regroup" — the way back

A second, deliberately narrow bottom bar (`SortingActionBar`) renders on Topic
and Timeline. **Regroup** drops the active view's drag overrides so the tiles
glide back into their packed clouds (or their date columns), with `pushHistory`
for undo and the same 470 ms glide a view switch uses. Selection ≥ 2 regroups
only those tiles — Tidy up's selection-first rule. It is gated on
`isSenseView`/`isTimelineView`, not on `view`, because both also require a real
project and `view` can still read `"sense"` in all-files mode.

### Labels name the pile, not one photo in it

In `cluster-logic.ts`:

- **Score = support × lift.** `(clDf/size) × (clDf/wsDf)`; `size` is constant
  inside a cluster, so ranking by `clDf²/wsDf` is equivalent — a ratio of two
  integers, compared by cross-multiplication so no float ordering enters the
  plan. A tag on 18 of 20 photos scores 16.2 against a hapax's 1.0.
- **A relaxing tier ladder**, never a hard gate: thematic + not a medium word +
  covers ≥ max(2, ¼) of the cluster → any category, same bar → not a medium word
  → anything. So a 2-photo cluster tagged only `place/kyiv` is still "kyiv", and
  a cluster that genuinely *is* all screenshots is called "screenshot".
- **A name-based stop-list** of medium/format words, demoting not banning. It has
  to be name-based: the analyze prompt gives Gemini no vocabulary guidance, so
  `screenshot` and `smartphone` arrive as legitimate `scene`/`object` tags. A
  stop-listed word never gets a partner — one honest word beats two.
- **The second tag has to earn it** (≥ 2/5 of the first's score) instead of being
  padded in by `slice(0, 2)`.
- **Collisions differentiate, they do not extend**: swap the second tag
  ("floor · mat" / "floor · wall"), capped at two tags, numeric suffix last.

### A name can be pinned, and a machine name is no longer permanent

- `topic_clusters.is_renamed`, plus `PATCH /api/topics/[id]` and double-click on
  a cloud's label. Renaming is curation, not model output, so it is the user's
  write —

  The gesture opens on the **second pointer-down**, not on a `dblclick`, and the
  editor commits from a **capture-phase window `pointerdown`**, not from `blur`
  alone. Both are forced by the same fact: the label and tile pointer-down
  handlers call `preventDefault()`. That suppresses the compat mouse events, so
  clicking another cloud or a photo fires no `blur` and used to leave a
  still-focused, 22 %-dimmed input swallowing every keystroke; and `dblclick`
  arrives only after both pointerups, each of which toggles cloud focus (0024),
  so every rename attempt dimmed the whole canvas and undimmed it again before
  the editor appeared. A `dblclick` handler on the label wrapper also fired for
  a double-click *inside* the input, resetting the draft to the old name.
  Taking over the second press avoids all three.
 but the same row holds `centroid`, the k-means stability anchor, and a
  forged centroid corrupts every future clustering of the workspace rather than
  one row. So the blanket UPDATE grant is narrowed with the revoke-then-
  column-grant pattern `init.sql:365-368` already uses for the
  `source_connections` token columns: an editor may write `label` and
  `is_renamed` and nothing else. Unlike RLS, a column ACL **raises** 42501
  instead of filtering rows.
- **A matched cluster's label is now recomputed** unless it is pinned — 0028
  froze the first machine guess forever, which is exactly why a bad name was
  permanent and an improved labeller could never reach an existing workspace.
  Stability now comes from an explicit human pin, not from freezing a guess.
  `planClusters` therefore assigns names in **two passes**: reserve every
  surviving name first, then assign in id order. `matches` arrives in
  greedy-similarity (float) order, and nothing that decides a label may iterate
  it.
- A pinned cluster is also **never deleted for failing to match** — it is
  retained and emptied (size 0, no members), including in the
  below-`MIN_CLUSTER_ASSETS` branch that used to wipe the whole table. Deleting
  it would have thrown a human's name away for good the first time a workspace
  dipped under eight analyzed photos.
- The `is_renamed` guard is re-checked in **SQL**, not only in `planClusters`:
  the advisory lock serializes cluster jobs against each other, but a rename can
  land between the job's SELECT and its UPDATE.

### Re-cluster on demand

`POST /api/topics/recluster` enqueues a workspace-scoped `cluster` job, with a
`queued|running` backlog guard. This **grants no new database privilege** —
`ai_jobs_insert` is `is_editor(workspace_id)` with no restriction on `type`, and
`supabase/tests/004` has always asserted an editor can insert one; the refusal
lived in zod alone. It costs zero credits (the handler is pure CPU over stored
embeddings, no Gemini call), so it does not violate the "AI only by button" rule
in either direction. It is its own route, not an arm of `createJobRequestSchema`,
because every arm of that union is asset-id-shaped and `POST /api/jobs` reads
`assetIds` unconditionally — the same reason `edit`, `purge` and `export` each
have their own. The payload's `workspace_id` is built from the caller's
server-resolved membership and never from the body: RLS validates the row's
column, not the JSON, and the worker runs that payload as `postgres`.

### Stored cluster labels are never folded into "Other"

`TOPIC_CLOUD_CAP` bounds the *heuristic's* sprawl — it is result-set-relative and
can invent a topic per read. A stored cluster is already bounded per workspace by
the worker's own `k`, and folding one discarded the stable semantic home ADR 0028
exists to give a photo; worse, which clusters survived depended on which project
you happened to open, since the fold counts only the rows that read returned.

## Consequences

- Topic stops decaying on its own. A re-cluster now re-packs the tiles it moved
  instead of stranding them, and a cloud's name can no longer be dragged into
  empty space by one tile — while a whole-cloud drag still carries it.
- **A cloud's name can now change on a re-cluster**, which 0028 explicitly
  avoided. That is the intended trade: with support-weighted scoring a rename
  signals real content drift rather than a coin flip, and anyone who wants a
  fixed name has a rename that pins it. Users who liked an auto-generated name
  should rename it to itself.
- Every existing workspace gets the better names on its next cluster run,
  because matched clusters are relabelled. Anyone who renamed first keeps theirs.
- `deriveTopics` can now render more than `TOPIC_CLOUD_CAP + 2` clouds — up to
  `k` (≤ 12) clusters plus six heuristic topics plus Other and Unsorted. The
  density ramp and the core-based anchor are what keep that legible.
- Retained renamed clusters accumulate as empty rows. They are bounded by how
  many names a human typed, and each one is a live re-match candidate, so this
  is deliberate rather than a leak — but nothing prunes them, and there is no UI
  to delete a cloud.
- The column grant makes `PATCH /api/topics/[id]` stricter than the
  `captions`/`facts` routes it otherwise mirrors: one extra key in the update
  body (including `updated_at`) turns the whole request into a 42501.
- Topic override buckets still grow monotonically in localStorage — a stale
  entry is now *ignored* rather than deleted, so it survives to re-apply if the
  photo returns to that cluster. Regroup is the only thing that clears them.
- The Map bucket (`galleryOverrides.map`) remains the dead path it was: nothing
  reads it. Untouched here on purpose.

## Amendment (2026-08-10, revised) — Topic keeps its connecting lines

An earlier revision of this amendment removed the tag-driven connecting lines
(`layout.edges`) from Topic. That was reverted: the lines are back, because the
clouds alone lost the "these files are related" signal the web carries. `CloudDecor`
renders the edge `<svg>` as before (ADR 0022). The short-lived artboard "mesh"
(all-to-all lines on an artboard) was dropped entirely — an artboard is now a
content pack by virtue of holding files, with no lines of its own (ADR 0043).
