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
- Import flow (#63): a fresh empty project auto-opens an **import modal** (left source picker — Local active, Drive/Dropbox `SOON` — right drop/browse zone) that uploads and links assets to the project; shared `lib/upload-client.ts` backs both the modal and the global drag-drop.
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
  Interim until the post-MVP embedding-clustering job (spec §13); Map's `country`
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
- **Remaining #17:** per-project `caption_prompt`, project members.

### Phase 6 — Cloud imports (~week 7) — Drive half ✅ DONE 2026-07-21 (#97–#101, #103; pulled ahead of Phase 5's remainder at the owner's call)

- **Drive — ✅ shipped:** popup code flow (`drive.file`, GIS `initCodeClient` — NO public callback route, ADR 0025) + AES-GCM token encryption (`TOKEN_ENC_KEY`, crypto lives once in `packages/shared/token-crypto`) → hand-rolled Picker (multi-file, MIME-filtered, LIST mode, `setAppId`, `login_hint`) → chunked `POST /api/imports` (status-aware dedupe: re-picks link into the project or reactivate soft-deleted/`source_missing` assets) → existing `ingest` job type (worker streams `files.get?alt=media`; originals never in R2 per §6). Day-1 spike 2026-07-21 verified the scope model on the real Cloud project (folder grants don't cascade; per-file grants are project-keyed and persistent; `alt=media` is byte-identical to Drive's own md5). Follow-ups: #102 (`schema:` unique indexes), spike step 5 (24–48 h grant persistence re-check).
- **Dropbox (#24, still open):** Chooser (direct links, no OAuth — ADR 0008) → `POST /api/imports` → worker streams bytes within the 4 h window; originals → R2 (ADR 0008); 429/`Retry-After` handling; stale-link (410) re-request guard.

**✅ Deploy checkpoint 3 — CLOSED 2026-07-21 (Drive path):** full journey verified on prod — connect Drive, pick files, they ingest (byte-identical originals streamed from Drive), analyze, and are searchable.

### Phase 7 — Export + hardening (~week 8)

Export handler (ZIP: owned originals else medium previews + note; `captions.csv` sidecar) → R2 `exports/` + presigned GET (7 d = R2 max). Deletion flows (soft-delete + R2 purge; `source_missing` on fetch failure keeps derivatives). Security pass per spec §12 (RLS audit, token handling, TTLs). Privacy Policy + ToS before first external user. Full QA on a real dirty archive.

---

## 3. Working agreements for this build

- Each phase = short-lived branches into `main`; deploy checkpoints must be green before the next phase starts (spec §15 discipline).
- Data reaches the UI through server-side readers (`lib/api.ts`, `lib/projects.ts`, `lib/bootstrap.ts`) awaited by Server Components, and through `app/api/*` route handlers for everything client-side — see ARCHITECTURE.md. The remaining direct `mock-data` importers get cleaned as their features go real.
- Every AI call writes a `usage_events` row from day 1 — no exceptions (future credits model).
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
