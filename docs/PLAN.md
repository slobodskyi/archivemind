# ArchiveMind MVP — Build Plan

Date: 2026-07-06 · Source spec: [TECH_SPEC.md](./TECH_SPEC.md) **v1.2**
Team: 2 devs (AI-assisted), trunk-based, squash-merge (see CONTRIBUTING.md).

This plan turns TECH_SPEC.md §15 into an executable order of work. The spec is
canonical for the domain model, architecture, models / libraries / config; this
plan is the sequencing. Decision records for the key calls live in `docs/decisions/`.

---

## 0. Spec amendments — folded into the spec

The 2026-07-03 pre-build verification amendments (originally `PLAN.md` §0) and the v1.2 Asset ≠ File revision are now folded directly into **[TECH_SPEC.md](./TECH_SPEC.md) v1.2** (§2–§14). This plan is the execution order only; where it names models / libraries / schema / spikes, the spec is canonical. (Section references below point at TECH_SPEC v1.2; the old "A#" amendment ids are retired.)

---

## 1. Current state → target (historical — written at build start; ARCHITECTURE.md tracks the live state)

**Have:** polished frontend mockup (Next 16.2.10, React 19, Tailwind v4, npm, single app at repo root). Data seam `lib/api.ts` in place (5 fns; only `getPhotos` consumed today). 235 mock photos, deterministic layouts, no undo/redo yet (journey asks for it — new work, Phase 5). Known seam leaks to fix during integration: `lib/format.ts`, `lib/layout.ts`, `hooks/useWorkspace.ts`, `components/map/MapCanvas.tsx`, `components/toolbar/AddToProjectPopover.tsx` import `mock-data` lookup tables directly; `lib/chat.ts` is the canned-LLM surface search replaces.

**Target:** monorepo `apps/web` (Vercel) + `apps/worker` (Railway) + `packages/shared` + `supabase/`, per spec §2–§3 (TECH_SPEC v1.2).

---

## 2. Build order

Two lanes after Phase 0: **Lane W (web)** and **Lane K (worker/pipeline)** — one dev each, swap as needed. **Migrations owner: Oleksandr (`slobodskyi`)** (spec §11); schema changes PR-only — see CONTRIBUTING.md.

### Phase 0 — Foundations — ✅ DONE 2026-07-10 (#38 #39 #43 #44 #46)

**0.1 Monorepo restructure** (one PR, one dev, no functional changes). Checklist from repo analysis:
- pnpm workspace + turborepo; root `package.json` (`packageManager` pin, engines), `pnpm-workspace.yaml`, `turbo.json`; delete `package-lock.json`.
- Move app → `apps/web` (app/, components/, hooks/, lib/, types/, configs). `@/*` tsconfig alias survives as-is (70 imports, zero parent-relative).
- `next.config.ts`: set `turbopack.root` (top-level key in Next 16) + `outputFileTracingRoot` to repo root (multiple-lockfile inference).
- `.gitignore`: un-anchor root-anchored patterns (`/node_modules`, `/.next/`, `/out/`, `/build`, `/AI-powered creator archive tool/`); add `.turbo/`.
- ESLint flat config moves as-is — it's already the Next-16 style (`defineConfig` + subpath exports); do NOT "normalize" to FlatCompat.
- CI: npm → pnpm/turbo (`pnpm/action-setup`, `pnpm install --frozen-lockfile`, `turbo run lint typecheck build`).
- Vercel: repoint Root Directory to `apps/web`, install cmd pnpm. `.claude/settings.json` + `launch.json` + AGENTS.md/CONTRIBUTING.md command docs → pnpm.
- Scaffold `packages/shared` (zod + domain types seeded from `types/` inventory) and empty `apps/worker`.
- Next-16 notes for all future work: `proxy.ts` (NOT `middleware.ts`); async-only `cookies()/headers()/params`.

**0.2 Accounts & infra** (other dev, parallel): Supabase project (EU region) + enable pgvector; Cloudflare R2 bucket + CORS (incl. `ExposeHeaders: ETag`); Railway project; Google Cloud project (OAuth client, Picker API key — note project *number* for `setAppId`); Dropbox app key + Chooser domain registration; Gemini **service-account AUTH key** (not a standard API key) with billing enabled (Tier 1+) — see spec §11; Vercel + Railway env vars per spec §11 (with `GEMINI_ANALYZE_MODEL` added); **Resend** account + verified sending domain, plugged into Supabase Auth as custom SMTP (the built-in mailer is dev-only, ~2 emails/h) — carries signup/reset emails now, invites/billing later; **Sentry** org with two projects (`archivemind-web`, `archivemind-worker`) → DSN env vars. Click-through checklist: issue #4 comment (2026-07-10).

**Environments (decided, issue #32):** dev = **local Supabase** (CLI + Docker; `supabase db reset` replays migrations), prod = the one EU cloud project, which doubles as shared testing until first external users (no real user data during the build); add a true staging project at Phase 7's security pass. R2: `-dev` and `-prod` buckets.

**0.3 Migration 0001 + RLS + auth**: full spec §4 schema (Broadcast trigger on `ai_jobs` per §5; `source_connections` effectively Drive-only per ADR 0008). RLS helpers `is_member/is_owner/is_editor` + policies on every table. Supabase Auth — email+password at launch; **Google login shipped as the fast-follow on 2026-07-20 (#89, closes #45)**, on its own Google Cloud OAuth client rather than the Picker's, since the Picker will need the `drive.file` scope (verified non-sensitive in 2026 — no CASA, no unverified-app cap; ADR 0025) and keeping import consent off the sign-in client keeps login scope-clean — with auth emails through Resend SMTP; `apps/web` auth screens + `proxy.ts` guard + first-login bootstrap (profile → workspace → owner membership, in app code). Wire `@sentry/nextjs` here, env-gated (no DSN = disabled locally).

**✅ Deploy checkpoint 1 — CLOSED 2026-07-10:** deployed web app on Vercel, sign-up → empty authed workspace, schema live, CI green.

### Phase 1 — Upload → ingest end-to-end — ✅ DONE 2026-07-10 (#48 #49 #50 #51 #53 #56; multipart → #54, PDF/HEIC-RAW sample QA → #9)

- **Lane W:** upload UI (drag-drop + file picker) → `POST /api/uploads/presign` (single PUT <100 MiB; fixed-size multipart above) → `POST /api/uploads/complete` (creates asset + file); assets list via `GET /api/assets` replacing `getPhotos()`→`getAssets()` in `lib/api.ts`; `useJobProgress` hook on the Broadcast channel.
- **Lane K:** worker skeleton on Railway (`node:22-slim`, session-pooler pg Pool max 2–5): claim loop (`FOR UPDATE SKIP LOCKED`), heartbeat, retry/backoff, reaper, graceful shutdown (spec §7 verbatim); `@sentry/node` capture around job execution. Ingest handler: sha256 dedup → EXIF (`exifr` / `exiftool-vendored` v36) → previews via sharp (+ `heic-decode` path, RAW cascade per §8.1) → R2 previews → `asset_exif`/`asset_previews` rows (dedup attaches file to existing asset) → auto-enqueue `analyze`.
- QA with dirty samples: HEIC from real iPhones, NEF/CR2/ARW, no-EXIF files (closes §14 items 1–2: HEIC throughput, RAW coverage).

**✅ Deploy checkpoint 2 — CLOSED 2026-07-10:** cloud worker (Railway) processes prod uploads end-to-end — previews & EXIF appear in the deployed UI (large-batch soak → #9; Realtime progress → #12).

### Phase 2 — Analyze pipeline — ✅ DONE 2026-07-10 (#55 #58 #59)

- **Lane K:** analyze handler (#55) — medium preview → `gemini-3.1-flash-lite` (`generateContent` + `responseSchema`) → tags/facts upserts; `gemini-embedding-2` (one `Content`, 768 dims) → `embeddings`; `usage_events` per call; 429 backoff. Verified with a real Gemini call (~$0.0004/photo).
- **Lane W:** drawer on real data (#58 — tags/facts/EXIF, dblclick sidebar → drawer); **Analyze N with AI** button → real `POST /api/jobs` + `useJobProgress` Broadcast channel → toast + `router.refresh()` (#59, closed #12). Mock `setInterval`/`finishBulk` deleted.

### Phase 5 (pulled forward) — Homepage + real projects — ✅ DONE 2026-07-10 (#62 #63; part of #17)

- Homepage hub at `/` (drawer sidebar + real project cards); canvas moved to `/projects/[id]` (`all` = whole workspace, else the project's M:N assets). Real CRUD: `POST /api/projects`, `POST /api/projects/[id]/assets`; `lib/projects.ts` card previews; `getRealPhotos(supabase, projectId?)`. `useWorkspace` project system is now real (mock `customProjects`/`photos[].project` gone).
- Import flow (#63): a fresh empty project auto-opens an **import modal** (left source picker — Local files, Google Drive and Dropbox, all live since Phase 6 — right drop/browse zone) that uploads and links assets to the project; shared `lib/upload-client.ts` backs both the modal and the global drag-drop.
- Sidebar + canvas views on real data (**#74**, 2026-07-14): homepage sidebar overhaul (search, data sources, recents, Archived/Trash); Timeline buckets on the real capture date, retiring the id-hash quirk of [ADR 0003](decisions/0003-preserve-source-quirks.md) (closes **#19**); Map/Topic become connected "cloud" clusters on live data (**#20**/**#21**) — the **Leaflet geo map is removed** (ADR [0016](decisions/0016-real-timeline-topic-map-views.md)→[0017](decisions/0017-column-grid-map-topic-photo-delete.md)→[0018](decisions/0018-cloud-clusters-map-topic-default-zoom.md); product decision — since revisited: the real geographic map returned as a MapLibre GL basemap over EXIF GPS, [ADR 0027](decisions/0027-map-view-is-a-real-geographic-map.md) #108–#115, not Leaflet). Project rename/archive/trash via `PATCH /api/projects/[id]`; photo delete from any view via `DELETE /api/assets/[id]` (soft delete per §12, part of **#26**). Migration `20260713000001` (`projects.archived_at`/`deleted_at`) — **on prod 2026-07-14**.
- Trash retention (**#75**, merged): `sweep_trashed_projects()` + partial index (migration `20260714000001`, **on prod 2026-07-14**), scheduled by the worker next to the reaper; enforces the 30-day window #74's UI already promised. [ADR 0019](decisions/0019-project-archive-trash-retention.md); pgTAP `002_retention.sql` — in CI as the required `db-tests` check since 2026-07-17 ([ADR 0020](decisions/0020-pgtap-in-ci.md)).
- **Remaining #17/Phase-5:** `caption_prompt` field, project members; canvas at scale (#18 virtualize; #22 — client interim shipped with #93, server-side layout store open). **Figma pixel-pass** on homepage + modal is a pending fast-follow.

### Phase 3 — Captions — ✅ DONE 2026-07-17 (#79 #82)

- **Worker (#79, closed #13):** caption handler — per asset × lang, medium preview + EXIF metadata + confirmed facts → styled Gemini caption → upsert guarded by `is_edited` (edited units skipped before the paid call); contracts (`captionJobPayloadSchema`, `CAPTION_PROMPTS`, `CAPTION_LANG_NAMES`) in `packages/shared`. Model pins re-verified same day (#35 closed): `generateContent` is now "Legacy" (no sunset; Interactions API is Google's recommended surface), and `gemini-embedding-2` officially supports cross-modal text↔image search — the Phase-4 embedding spike is pre-answered. Retry re-billing is systemic to analyze+caption → #80.
- **Web (#82, closed #14):** `POST /api/jobs` became a discriminated union (caption carries deduped langs + style; `total_items` = asset × lang); `PATCH /api/captions/[id]` (text edit → `is_edited=true`; `resetEdited` = the confirmed-overwrite unlock before a regenerate); captions ride the asset select into the drawer — lang/style switching on real rows, editable text with dirty-Save, Regenerate → confirm → single-unit caption job over the existing Broadcast path. Mock `CAPTIONS` retired from `lib/format.ts`. Deferred: bulk captioning from BulkAiPanel (toggle stays cosmetic), per-project `caption_prompt` (needs project context in the payload).

**Reference material:** an earlier attempt (~90% — worker handler + Regenerate) is archived at the tag **`archive/captions-wip`** (was the branch `feat/captions`, retired 2026-07-14 — it predates the homepage restructure and its web-side files conflict with current `main`). **Reimplement cleanly on current `main`; do not merge the tag.** Worth porting: `apps/worker/src/handlers/caption.ts`, `services/gemini.ts`, and the zod contracts in `packages/shared/src/index.ts`. Read it with `git show archive/captions-wip:<path>`, or `git checkout -b <new> archive/captions-wip` to browse the whole tree.

### Phase 4 — Search — ✅ DONE 2026-07-20 (#83 #84)

`GET /api/search`: `gemini-3.1-flash-lite` query parse (structured output via `generateContent`) → embed query text into the same space → pgvector cosine (HNSW) scoped to workspace/project + metadata joins (dates from `asset_exif.taken_at`, places via `gps_label`/place-tags with the no-GPS fallback, tag boost) → top-N with matched-filter explanation. Wired into the chat panel; `search_query` usage logged per call.

- **#83 (closed #15):** migration `20260717000001` — `search_assets()` RPC (SECURITY INVOKER: RLS is the boundary; cosine + date/place/tag filters, tag-boost ranking; pgTAP `003_search.sql`) + `usage_events` INSERT policy for members — **on prod 2026-07-20** (owner runbook, verified via ledger + empty `db diff`); `GET /api/search` route (parse → embed → RPC → results, graceful degradation when the parse model hiccups); web-side Gemini client `lib/gemini.ts`; `@google/genai` added to `apps/web`. Vercel already carried `GEMINI_API_KEY`/`GEMINI_ANALYZE_MODEL`. Cross-modal text→image search verified against official docs (#35).
- **#84 (closed #16):** chat panel IS Smart Search — `sendChat` calls `GET /api/search` (project-scoped on a project canvas), answers carry a thumb strip (click = drawer) + "Select N on canvas"; zero-hit answers explain that only analyzed photos are searchable. Canned `CHAT_REPLIES`/`CHAT_FALLBACK_REPLY` deleted; `lib/chat.ts` keeps only static copy (greeting, HELP_FAQ, search placeholder).

**Search relevance, post-Phase-4 refinements (both on prod 2026-07-22):**
- **#124 (relevance tiers, ADR 0029):** results split into a "strong" answer (explicit tag/place matches + the top cosine rows) and a collapsed "N more distant" tail; tag matches outrank cosine, and the chat copy names only filters that actually hit a result. `search_assets` v2 (`20260722000002`) adds whole-word matching for multi-word tags.
- **#125 (hybrid lexical + EXIF, ADR 0031):** `search_assets` v3 (`20260722000004`) adds a lexical signal — Postgres FTS (`'simple'`, GIN-indexed) over the AI description (`embeddings.content`) + `facts.text`, promoted to the strong tier like a tag — plus EXIF filters (camera make/model/lens, ISO range, aperture). Parse gains `camera_terms`/`iso_min`/`iso_max`/`aperture`. Collided with #126 on the `20260722000003` prefix + ADR 0030 (both renumbered off). On prod: the push applied the DDL but crashed before recording the ledger (pgdelta), reconciled with `migration repair` (schema verified via empty `db diff`). Raw OCR persistence deferred — the worker still discards `ocr_text`.

**MVP core loop is complete as of 2026-07-20: upload → ingest → analyze → captions → search.**

### Canvas UX unification (GG's design branch, merged 2026-07-20, #93)

- Timeline/Map/Topic became grouping sorts over ONE canvas (shared `ProjectAssetView`;
  tiles glide between views; `CloudDecor`/`CloudLabels` backdrops; the column grid and
  `CloudView` deleted); every tool works on every view; fixed 75% default zoom; homepage
  "+ New project" also on Recents ([ADR 0022](decisions/0022-timeline-clouds-and-live-cloud-labels.md)).
- Connecting lines went **real** at merge time: shared-AI-tag relations (capped to stay
  O(n) — ambient tags and per-file link budgets), replacing the branch's demo complete
  graph; the branch's `DEMO_CLOUDS` scaffold was removed before landing.
- **Part of #22 shipped as an interim:** per-project canvas arrangement (tile drags,
  frames, sticky notes) persists client-side in versioned `localStorage`; undo/redo for
  drags already existed (ADR 0012's `Snapshot` history). Still open from #22: the
  server-side `PUT /api/canvas/layout`. Still open for #18: virtualization — and the
  known drag-relayout cost on large single clouds is deferred to that work (ADR 0022
  Consequences).
- Same-day follow-up: **Topic clouds went real** — `group` derived from AI tags at
  read time (`lib/topics.ts`: event→scene→object priority, ambient-tag skip, top-6 +
  Other, unanalyzed → Unsorted; [ADR 0023](decisions/0023-topic-clouds-derived-from-tags.md)).
  The tag heuristic was an interim; the embedding-clustering job (spec §13) has since
  landed and demoted it to the fallback — see the Phase-5 entry below and
  [ADR 0028](decisions/0028-topic-clusters-from-embedding-kmeans.md). Map's `country`
  default stays inert but is now **unread** — Map became a real MapLibre geo map
  over EXIF GPS ([ADR 0027](decisions/0027-map-view-is-a-real-geographic-map.md),
  superseding the Map half of 0018; reverse-geocoded labels via
  [ADR 0026](decisions/0026-offline-reverse-geocoding.md)).
- GG's next design iteration (2026-07-21, cherry-picked from
  `feat/timeline-date-axis-cloud-focus` — the branch was stacked on the pre-#93
  base, so only its delta landed): **Timeline = horizontal per-day date axis**
  (evenly-spaced DD/MM/YYYY columns, files split above/below the axis, drag
  clamped to the date column, no tag lines there), **cloud focus** (click a
  label — others fade) + **whole-cloud drag** (drag a label) on all grouping
  views, sparkle/move icon refresh
  ([ADR 0024](decisions/0024-timeline-date-axis-cloud-focus.md)).

### Phase 5 — Projects + canvas at scale (~weeks 6–7)

Much of the original Phase-5 list shipped early (projects CRUD + M:N and
add-to-project with #62 on 2026-07-10; all four views on real data via
#74/#93/#94/#95; real capture-date bucketing, per-asset EXIF and titles since
Phases 1–2). What actually remains:

- **Canvas at scale (#18)** — virtualization: cap mounted tiles, materialize
  only the viewport (real archives 10k–30k vs the ≤500-row read today; the
  riskiest frontend task — spike early with 20k synthetic rows). The known
  drag-relayout cost on large single clouds (ADR 0022 Consequences) lands
  here too. The old `GET /api/canvas` sources→folders aggregate design
  predates #74's removal of the source-hub drill-down — re-scope it to the
  flat project canvas before building.
- **Server-side layout persistence (#22 remainder)** — `PUT /api/canvas/layout`;
  the client half (versioned `localStorage` + undo/redo) already ships (#93,
  ADR 0022).
- **Canvas folders — ✅ shipped 2026-07-23 (ADR 0034):** combine files into
  server-backed folders on the Canvas (collapse ↔ expand in place, drag files
  in/out, rename, ungroup). New `canvas_groups` + `canvas_group_assets` tables
  (membership on the server, geometry in the `localStorage` groupGeom bucket —
  ADR 0022 still holds); routes under `app/api/canvas-groups/*`; the "Group"
  action-bar button is now real. Artboards still draw client `Frame`s;
  promoting them to `kind='artboard'` server groups is the follow-up.
- **Remaining #17:** per-project `caption_prompt`, project members.
- **Topic embedding clustering — ✅ DONE 2026-07-22 (#122), LIVE on prod** — the
  stable replacement for the read-time tag heuristic (ADR 0023): a deterministic
  k-means `cluster` worker job over the image embeddings writes `topic_clusters`
  + `assets.cluster_id`, labelled from each cluster's most discriminative tags,
  matched across runs so ids/labels stay stable; enqueued automatically after
  analyze with **zero Gemini calls** (pure CPU — the "AI only by button" rule
  holds). `lib/topics.ts` reads the stored label first, tag heuristic as
  fallback ([ADR 0028](decisions/0028-topic-clusters-from-embedding-kmeans.md);
  pgTAP `004`). Migration `20260722000001` (`topic_clusters` + `assets.cluster_id`
  + `cluster` job type) — **on prod 2026-07-22** (owner runbook, verified via
  ledger + empty `db diff`). End-to-end verified live: a cluster job over an
  11-asset workspace produced two discriminative-labelled clouds covering all 11,
  stable (same ids/labels, no duplicates) across a re-run.
- **Topic view legibility — ✅ DONE 2026-07-27 (#182), LIVE on prod** — an audit
  of the Topic tab, and the fixes for what it found
  ([ADR 0038](decisions/0038-topic-view-legibility.md)). Every defect was
  reproduced by running the code, not by reading it: **one** stale drag override
  stretched a cloud's bbox 581 px → 1856 px and slid its label 638 px into empty
  canvas (0023 predicted this verbatim and named the fix); labels ranked by
  discriminativeness alone, so a tag on one photo scored the maximum and a
  screenshot cluster came out `"smartphone · book cover"`; and `planClusters`
  copied the stored label while the handler never wrote `label`, so **any**
  labeller improvement would have been invisible on every existing workspace.
  Now: overrides are anchored to the cluster **id** (a relabel and a rename both
  leave the arrangement alone) and ignored once it changes; a cloud's
  label/backdrop anchor on its *core* (members within 2.2 packed radii of the
  median), so one flung tile no longer drags the name away while a whole-cloud
  drag still does; **Regroup** on Topic/Timeline; **Re-cluster** on demand
  (`POST /api/topics/recluster`, zero credits — `ai_jobs_insert` never restricted
  `type`, the refusal lived in zod); **rename** a cloud (`PATCH /api/topics/:id`
  + `topic_clusters.is_renamed`, which also protects the cluster from deletion
  when its centroid stops matching); and stored cluster labels are exempt from
  the `TOPIC_CLOUD_CAP` "Other" fold, which now bounds only the heuristic.
  pgTAP `004` raised 9 → 21 assertions. Migration `20260727000003` — **on prod
  2026-07-27**, verified via ledger only: Docker on the owner's machine returns
  500, which takes out `db diff`'s shadow database, `db dump`, and makes
  `db push` print a `pgdelta` warning after succeeding.
- **Editable Topic clouds — ✅ DONE 2026-08-10, on prod** —
  Topic now keeps the machine answer and the person's decision as different
  facts ([ADR 0042](decisions/0042-editable-topic-clouds.md)):
  `assets.cluster_id` remains the latest deterministic k-means baseline, while
  one RLS-scoped `topic_cluster_overrides` row can replace it at read time;
  deleting that row is **Return to AI** with no reconstruction or model call.
  `topic_clusters.origin = generated | manual` keeps centroid-bearing worker
  clusters separate from centroid-less human topics, and stable UUID identity
  means rename never changes membership, colour or saved arrangement. A normal
  empty-space drag still arranges the current canvas; membership changes only
  through a deliberate cloud drop target or Move-to-topic menu, with bulk
  create/move/reset, repacking and Undo. `GET/POST /api/topics`,
  `PUT /api/topics/assignments` and manual-only `DELETE /api/topics/:id` resolve
  the workspace server-side and call three atomic, editor-gated RPCs. Re-cluster
  ignores manual rows and retains generated rows referenced by overrides, so it
  refreshes the AI baseline without erasing curation and still costs zero
  credits. Migration `20260810000001` (`topic_clusters.origin` + nullable/check-
  constrained centroid + `topic_cluster_overrides` + RPCs; pgTAP `014`, 36
  assertions) — **on prod 2026-08-10**, verified through the linked migration
  ledger and a clean post-push dry-run. Docker on the owner's machine still
  returns 500 while provisioning `db diff`'s shadow database, so that optional
  drift check could not run; the asset read keeps its migration-gap fallback.
- **Colour labels + the LABELS view — ✅ DONE 2026-08-08, on prod** (the LABELS
  *view* was later retired — see the canvas redesign entry below; the label, the
  filter and the migration all stand) — the
  archive had four ways to group photos and all four were derived
  from the file (date, GPS, the model's reading, none). This adds the first one
  that records a *decision*
  ([ADR 0040](decisions/0040-colour-labels-as-a-human-curation-axis.md)):
  `assets.label`, one of seven macOS colours, **single-valued** (a tile packs
  into exactly one cloud) and written only by a person. It is deliberately not a
  `tags` row — that table feeds the Topic heuristic (0023), the connecting-line
  web (0022) and search's explicit tier (0029/0031), so a tag named `red` would
  have grown a "red" cloud and answered a text search for the colour. One swatch
  row assigns it from four places (top of the right-click menu, action bar,
  drawer, and keys `1`–`7` / `0` — bare digits, because `⌘1`–`⌘7` switches
  browser tabs), all through `POST /api/assets/label` with an Undo toast that
  restores each photo's *previous* colour. The seven names are renameable per
  workspace (`workspace_labels`, `PATCH /api/labels`; only renamed colours have
  a row, so every existing workspace is already correct with zero rows) by the
  same double-click gesture ADR 0038 gave Topic clouds. The left toolbar's
  filter **hides tiles without moving them** — layouts still run over the full
  set, the filter is applied at one seam (`visibleTilePositions`), so artboards,
  folder contents, frame counts and exports keep seeing the real geometry — and
  **LABELS** is the fifth view, one cloud per colour plus `No label`, reusing
  `buildCloudLayout` with the colour as both cloud key and staleness anchor (so
  re-colouring a dragged tile re-packs it) and the tag web switched off. Zero
  credits (ADR 0037 — no model runs). Migration `20260808000001`
  (`asset_label` enum + `assets.label` + `workspace_labels` + RLS; pgTAP `012`,
  18 assertions) — **on prod 2026-08-08** (reconfirmed in the linked ledger on
  2026-08-10); the canvas read still degrades to the pre-label select on `42703`
  for migration-gap resilience.
- **Image editing — Tier 0 (crop / rotate 90° / straighten / flip) — ✅ DONE
  2026-07-22 (#126; live-refresh fix #128), LIVE on prod** — **non-destructive**
  ([ADR 0030](decisions/0030-non-destructive-image-editing.md)): a stored,
  resolution-independent `recipe` + rendered edited previews in a new
  `asset_edits` table; `asset_previews` (the originals) are **never** overwritten,
  so reset is just dropping the row (instant, free). The worker renders edited
  previews from the asset's own **medium preview** — which R2 already holds for
  *every* source (upload / gdrive / dropbox alike) — so editing needs no original
  bytes and no source-specific path, and the ADR 0025 "Drive originals never in
  R2" invariant is untouched. The client only builds the recipe (live CSS preview
  + crop overlay); the `edit` worker job (sharp) is authoritative, and shared
  geometry in `packages/shared` (`workingDimensions` / `resolveCropRect` /
  `inscribedCropForStraighten`) keeps preview and render pixel-consistent. Drawer
  **Edit** button → `POST /api/assets/[id]/edit` (GET recipe · DELETE reset); the
  read path prefers the edited previews so every view reflects the edit. Migration
  `20260722000003` (`asset_edits` + `edit` job type + RLS; pgTAP `005`) — **on prod
  2026-07-22** (owner runbook; the ledger needed a `migration repair` reconciliation
  after a parallel branch had pushed a colliding `20260722000003` timestamp — a
  reminder that two branches must never reuse a migration number — verified via
  ledger + empty `db diff`). Edit jobs render fast (local sharp, no Gemini), so
  #128 refreshes the canvas on **any** edit completing (like `cluster`) rather than
  through the activeJobId-gated path, so edited previews appear without a manual
  reload. Follow-up: re-editing the same asset reuses a stable R2 key, so a second
  edit can be browser-cached inside the 30-min presign window (cache-bust when it
  surfaces).

### Phase 6 — Cloud imports (~week 7) — ✅ DONE 2026-07-21 (Drive: #97–#101, #103 · Dropbox: #105–#107; pulled ahead of Phase 5's remainder at the owner's call)

- **Drive — ✅ shipped:** popup code flow (`drive.file`, GIS `initCodeClient` — NO public callback route, ADR 0025) + AES-GCM token encryption (`TOKEN_ENC_KEY`, crypto lives once in `packages/shared/token-crypto`) → hand-rolled Picker (multi-file, MIME-filtered, LIST mode, `setAppId`, `login_hint`) → chunked `POST /api/imports` (status-aware dedupe: re-picks link into the project or reactivate soft-deleted/`source_missing` assets) → existing `ingest` job type (worker streams `files.get?alt=media`; originals never in R2 per §6). Day-1 spike 2026-07-21 verified the scope model on the real Cloud project (folder grants don't cascade; per-file grants are project-keyed and persistent; `alt=media` is byte-identical to Drive's own md5). Follow-ups: #102 (`schema:` unique indexes), spike step 5 (24–48 h grant persistence re-check).
- **Dropbox — ✅ shipped (#105–#107; issue #24 stays open until the prod click-through is confirmed):** Chooser drop-in (direct links, multiselect, **zero OAuth** — no connection row, no tokens; ADR 0008), links SSRF-gated to `dl.dropboxusercontent.com` in `packages/shared` → `POST /api/imports` (provider union, one shared dedupe/link/reactivate core with Drive) → worker fetches each link ONCE inside the 4 h window and stores the original in R2, then the normal ingest pipeline runs. 429/`Retry-After` backoff and the stale-link guard (410/404 → `dropbox_link_expired`, re-pick heals) live in `apps/worker/src/services/dropbox.ts`.

**✅ Deploy checkpoint 3 — CLOSED 2026-07-21 (Drive path):** full journey verified on prod — connect Drive, pick files, they ingest (byte-identical originals streamed from Drive), analyze, and are searchable.

### Phase 7 — Export + hardening (~week 8)

~~Export handler (ZIP: owned originals else medium previews + note; `captions.csv` sidecar) → R2 `exports/` + presigned GET (7 d = R2 max).~~ — **✅ DONE 2026-07-27 (closes #25).** The reasoning for every call — why facts left the PDF, why the artifact is keyed rather than URL'd, why the ZIP writer is hand-rolled — is in ADR 0035's `## Amendments`, not in this line. All three formats ship: `POST /api/exports` → `export` worker job with `options.format` = `pdf` (laid-out document, `pdf-lib` + embedded Cyrillic font, one-per-page or grid, optional cover + page footers) | `captions_csv` (one row per photo: filename, full EXIF, place, tags, AI description, facts split by review status, captions per language) | `zip` (two shapes the user picks with `zipContents`: **originals** — the stored files, with web-size previews standing in for Drive-linked assets whose originals were never copied into R2, each substitution named in a `README.txt`; or **web** — 1024px previews of everything, small enough to email. The README carries the workspace rights block either way, and `captions.csv` rides inside both). The worker writes the R2 KEY to `ai_jobs.payload.result_key` and `GET /api/exports` presigns it per request — no bearer URL is stored or broadcast. Artifacts are deleted by `sweepExpiredExports` after `EXPORT_RETENTION_DAYS`, and `purge.ts` erases any artifact containing an erased photo. Sources the medium previews (edited-medium when present), so the PDF works for Drive-linked assets. Migration `20260727000001` adds the workspace credit/rights block the deliverables carry — **on prod 2026-07-27** (owner runbook: `db push` from clean `main`, then `migration list --linked` **and** `db diff --linked` → "No schema changes found"; the latter needs Docker, so it is skippable by accident). ~~Deletion flows (soft-delete + R2 purge; `source_missing` on fetch failure keeps derivatives)~~ — **✅ pulled forward, shipped 2026-07-23 (ADR 0033):** photo trash with undo + Restore + 30-day `sweep_deleted_assets()` → `purge` worker job (R2 bytes + DB derivatives erased, dedup tombstone kept), Trash view lists photos with day countdowns, "Delete permanently"/"Empty trash", edit-reset cleans its orphaned R2 objects; `source_missing` still keeps derivatives. Security pass per spec §12 (RLS audit, token handling, TTLs). **GDPR right-to-erasure: account/workspace-level "delete everything" flow (rows + R2, incl. tombstones) — still open, deliberately NOT covered by ADR 0033; the purge handler is its building block.** Privacy Policy + ToS before first external user. Full QA on a real dirty archive.

### Usage & Storage — ✅ DONE 2026-07-27, LIVE on prod (#177 · #178 · #179, [ADR 0037](decisions/0037-usage-metering-and-the-credit-unit.md))

Not in any phase's original list — it came out of the account menu's third
"coming soon" toast, and building it exposed that the metering §11 rule 11
promised was half-built.

- **The credit unit is now defined, not just deferred:** `1 credit = 1 AI action
  on 1 photo` — analyze 1, caption 1 *per language*, and `embedding` /
  `search_query` / `export` / `asset_ingested` **0**. The embedding is the second
  half of the same analyze call (counting it would double every analysis the day
  a limit is enforced) and search is the core loop. Storage stays a separate axis
  in bytes. Defined once in `packages/shared/src/usage.ts`, imported by the
  worker that writes `usage_events` and the reader that totals them.
- **Enforcement is still out of MVP** (spec §13): `plans` ships `beta` 50 GiB/5k ·
  `creator` 500 GiB/25k · `studio` 2 TiB/100k, all with `enforced = false`. No
  policy, trigger or code path reads a limit — they exist so the meter has a
  denominator and so enforcement later reads numbers collected truthfully from
  the start.
- **What was actually missing:** `asset_previews`/`asset_edits` stored R2 keys
  with no size and the export job only `result_key`, so of four byte buckets only
  originals were measurable; `ingest` wrote no `usage_event` at all; and
  `cost_usd` had existed since migration 0001 written by nobody. Each is now
  recorded by the handler that already holds the buffer, and every usage write
  goes through `apps/worker/src/services/usage.ts`. Historic rows were filled by
  `apps/worker/src/scripts/backfill-derivative-bytes.ts` (run against prod:
  146 previews, 6 edit rows, 6 export artifacts — every workspace now reports
  zero unmeasured files).
- Migration `20260727000002` (`plans`, `workspaces.plan`, the byte columns,
  `usage_events.bytes`, and the SECURITY INVOKER `workspace_usage(ws)` RPC) —
  **on prod 2026-07-27**, verified by ledger + direct object checks (`db diff`
  skipped: Docker was down — see [ADR 0037](decisions/0037-usage-metering-and-the-credit-unit.md)).
  pgTAP `010_usage.sql` pins the arithmetic bucket by bucket and asserts that
  passing another workspace's id returns zeros.
- **Shape correction (#179, owner's call):** it first shipped as a standalone
  page with its own header. It is now the homepage's **fifth `ViewMode`**, beside
  Archived and Trash — one signed-in chrome. New signed-in surfaces belong there
  as views, not as new layouts.
- Deliberately left: `Account Settings` / `Billing & Plan` still toast (no pages
  exist; a link to a 404 is worse), no usage CSV export, no deep link from the
  storage card into Trash. **Never verified visually** — the page has not been
  looked at in a browser by anyone but the owner.

### Canvas redesign — taken from `feat/workspace-tools-edits` (2026-08-12)

George's design branch, landed as a four-PR stack rather than merged as-is: the
branch carried real functional losses beside the visual work, and each was either
kept or removed on purpose.

1. **Chrome + navigation.** `AppHeader` pins to the viewport (`position: fixed`
   + safe-area, with the height in `--hdr` so the seven call sites that hardcoded
   `52` follow it). `ViewSwitcher`, a bottom segmented control, replaces the
   header tabs *and* the separate Workspace toggle. `InfiniteGrid` gains ruled
   lines on Canvas / dots on the sorting views. **The LABELS view is retired**
   ([ADR 0040](decisions/0040-colour-labels-as-a-human-curation-axis.md)
   amended) — arrangements made in it are dropped from `localStorage`; nothing
   on the server moved.
2. **Tool rail + colour control.** The rail is identical in every view. The
   colour swatch is context-sensitive on both bottom bars: it marks a selection,
   or filters when there is none. `LabelFilterPanel` is gone, and with it the
   per-colour counts and the only entry point for renaming a colour (kept in the
   data, deliberately unreachable). The filter is reachable in **all-files**
   again, which George's version had dropped.
3. **Drawing moves onto the sticky note**
   ([ADR 0041](decisions/0041-annotations-carry-their-own-geometry.md) amended —
   the branch claimed this amendment twice and never wrote it). Rich text is
   syntax in the same plain string as the checklist. Two regressions in the
   branch were fixed rather than shipped: palm rejection (a stroke is now bound
   to the pointer that started it) and the note's font-size control (threaded to
   the card and never called). ⚠️ **Canvas ink already drawn on prod is now
   invisible** — `kind='ink'` rows are kept and still parse, nothing renders
   them, and whether they are deleted is an open, reversible decision.
4. **Workspaces** ([ADR 0044](decisions/0044-workspaces-as-a-file-scope.md)) — a
   named, colour-coded file scope, `localStorage` for now, taken **additively**:
   opening one narrows the canvas and nothing else changes. The branch made it a
   mode that hid existing notes and folders behind "create a workspace first".
   **Backend not built** — the ADR is its spec (`boards` + `board_assets`, the
   routes, and `board_id` on notes/folders for per-workspace state).

**No migrations in any of the four.** Nothing here has been verified on a real
device or against prod data; every check is `lint`/`typecheck`/`test`/`build`
plus static-render screenshots of the changed surfaces.

---

## 3. Working agreements for this build

- Each phase = short-lived branches into `main`; deploy checkpoints must be green before the next phase starts (spec §15 discipline).
- Data reaches the UI through server-side readers (`lib/api.ts`, `lib/projects.ts`, `lib/bootstrap.ts`) awaited by Server Components, and through `app/api/*` route handlers for everything client-side — see ARCHITECTURE.md. The remaining direct `mock-data` importers get cleaned as their features go real.
- Every AI call writes a `usage_events` row from day 1 — no exceptions. Export writes one too (units = the page count), which is what makes R2 growth attributable to a workspace after the fact.
- Decision records for the key backend calls (accepted; expand as phases start): [0007 generateContent-over-Interactions](decisions/0007-generatecontent-over-interactions.md), [0008 dropbox-originals-in-r2](decisions/0008-dropbox-originals-in-r2.md) (Phase 6), [0009 broadcast-over-postgres-changes](decisions/0009-broadcast-over-postgres-changes.md) (Phase 0), [0010 analyze-model-choice](decisions/0010-analyze-model-choice.md) (Phase 2), [0011 asset-over-file](decisions/0011-asset-over-file.md) (the v1.2 domain model), [0025 drive-import-popup-code-flow](decisions/0025-drive-import-popup-code-flow-encrypted-refresh-tokens.md) (Phase 6).
- Re-verify model ids/prices when Phase 2 starts — Gemini's surface moves fast (model sunsets, shifting API shapes). We pin `generateContent` + `gemini-3.1-flash-lite` (ADR 0007 / 0010) and evaluate `gemini-3.5-flash` at Phase 2.

---

## 4. Open items from the 2026-07-06 setup audit (status as of 2026-07-21)

Most items got ticketed and several are done — kept here for the audit trail:

- **Test strategy + CI wiring — ✅ DONE** (issue #31 closed; ADR 0013 → ADR 0020:
  Vitest across the workspace in the `checks` job, pgTAP as the required
  `db-tests` check).
- **Source real sample corpora — OPEN, issue #33, still unowned.** M2 and the
  Phase-1/Phase-7 QA issues gate on real dirty files (500+ mixed, real-iPhone
  HEIC, NEF/CR2/ARW, no-EXIF). Still the dependency most likely to block a
  milestone.
- **Seam-leak cleanup — tracked as issue #34.** Three direct `mock-data`
  importers remain (`lib/format.ts`, `lib/layout.ts`,
  `components/sidebar/SourceBrowserSidebar.tsx`). Related dead mocks with zero
  callers: `lib/api.ts`'s `getPhoto`/`getProjects`/`getGroups`/`getSources`,
  `lib/projects.ts::getAllAssetsCount`, `lib/layout.ts::sourcesGallery`.
- **Phase-2 analyze-model re-verify — ✅ DONE 2026-07-17** (was issue #35, closed:
  pins re-confirmed against official docs; `generateContent` now branded
  "Legacy" with no sunset; cross-modal embedding search pre-answered the
  Phase-4 spike). Re-check the deprecation table early 2027.
- **dev vs prod environments (decided 2026-07-10, issue #32 closed).** Local
  Supabase for dev; one EU cloud project as prod (doubles as shared testing
  until first external users); staging added at Phase 7. Provisioning itself
  stays issue #4.
