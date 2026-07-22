# 0030. Non-destructive image editing (Tier 0: crop / rotate / straighten / flip)

Date: 2026-07-22

Status: Accepted

## Context

We want basic in-app image editing. The first tier is pure geometry — crop,
rotate 90°, straighten (fine rotation), flip — with tonal adjustments (brightness
/contrast/…) deferred to a later tier.

Two constraints shape the design:

1. **This is an archive.** The original must never be lost or degraded, and an
   edit must be reversible. Destructive editing (overwrite the previews, throw
   away the source) is disqualified.

2. **Google Drive assets have no original in R2.** Per ADR 0025 / TECH_SPEC §6,
   Drive-linked files keep `files.r2_key = null`; the worker streams their bytes
   at ingest to build previews and never stores the original — only the webp
   `asset_previews` (thumb 256 / medium 1024) live in R2. Uploads and Dropbox
   *do* have an R2 original. So "edit the original file" is not a uniform
   operation across sources, and the naive fix — copy the Drive original into R2
   so we can edit it — would break the very invariant ADR 0025 exists to hold.

The tension looked like it was about *where the source pixels come from*. It is
not. The reframe that dissolves it: **an edit is not the original — it is a new
derived artifact the user created.** Storing *that* is consistent with never
storing the untouched Drive original.

## Decision

**Edit non-destructively, in place, storing a resolution-independent recipe plus
rendered edited previews in a new `asset_edits` table. The originals in
`asset_previews` are never touched.**

- **`asset_edits`** (one row per asset): `recipe jsonb` (the source of truth) +
  `edited_thumb_key` / `edited_medium_key` (the worker's rendered previews in R2
  under `{workspace_id}/edits/{asset_id}/{size}.webp`). RLS: members SELECT,
  editors DELETE; INSERT/UPDATE are worker-only (the worker writes as `postgres`
  and bypasses RLS — same custody model as `asset_previews` / `topic_clusters`).

- **The render source is the asset's own medium preview**, which R2 holds for
  *every* source. So the worker needs no original bytes and no source-specific
  path — **gdrive, dropbox and upload all edit identically**, and the ADR 0025
  invariant is untouched (we never fetch or store a Drive original to edit). The
  recipe is resolution-independent, so a future full-resolution re-render (for
  export) can re-fetch the true original then, without changing anything here.

- **The read path prefers the edited previews** when an `asset_edits` row exists
  (`lib/assets.ts` for the thumb + tile aspect, `/api/assets/[id]/medium` for the
  drawer), so every view reflects the edit with no change to how views read.

- **Reset = `DELETE` the `asset_edits` row** (a first-party web action, editors
  only). Because the originals were never overwritten, the views snap back on the
  next refresh — instant, free, no worker round-trip.

- **The client only ever produces a recipe.** `ImageEditor.tsx` renders a live
  CSS preview and a crop overlay; on Save it POSTs the recipe to
  `/api/assets/[id]/edit`, which enqueues an `edit` job. The worker
  (`edit-render.ts`, sharp) is authoritative.

- **One geometry module, two consumers.** `packages/shared` owns the recipe
  schema and the pure geometry (`workingDimensions`, `resolveCropRect`,
  `inscribedCropForStraighten`). The worker (sharp) and the client (CSS + crop
  overlay) both apply the recipe in the *same* fixed order —
  **flip → a single combined rotate of `(rotate + straighten)°` → crop** — so the
  preview matches the render by construction. The crop is normalized `[0,1]`
  within the *working frame* (the rotation's bounding box); a straighten with no
  manual crop auto-insets to the largest corner-free rectangle.

## Consequences

- Editing is **source-agnostic and cheap**: no Drive re-download, no original
  bytes, one medium-preview read + a sharp render. The gdrive "problem" simply
  does not arise.
- **Truly non-destructive & reversible** for every source, including gdrive:
  reset drops one row; the pristine `asset_previews` were never modified.
- **Tier-0 fidelity is capped at the medium preview (≤1024px).** The app only
  ever renders thumb/medium, so this matches the display ceiling it already has —
  but a *full-resolution* edited output (for download/export) is intentionally
  not produced yet. When export ships it re-applies the stored recipe to the true
  original (fetched from Drive for gdrive at that point). Deferring this is the
  main thing we gave up.
- **Orphaned edited R2 objects** after a reset are left for a later purge (stable
  keys mean a re-edit overwrites them; asset delete purges them) — the same
  "derivative purge is a background job" stance as soft delete (`/api/assets/[id]`).
- The `edit` job type is worker-run but enqueued by a **dedicated route**
  (`POST /api/assets/[id]/edit`), not `POST /api/jobs` — like captions' own PATCH
  route — so it stays out of the bulk analyze/caption union.
- Editing does **not** re-run analyze: tags/embeddings still describe the
  original composition (AI stays button-only). A crop can therefore drift from
  its tags until the user re-analyzes — an accepted Tier-0 limitation.
