<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ArchiveMind

AI-powered creator archive workspace — infinite-canvas photo archive UI.
A **pnpm + turborepo monorepo**, live in production (Phases 0–2 shipped 2026-07-10,
plus Phase 5's homepage + real projects pulled forward, Phases 3–4 (captions,
search) done 2026-07-17/20, and Phase 6's **cloud imports** done 2026-07-21 —
Google Drive (#97–#103, ADR 0025) and Dropbox (#105–#107, ADR 0008), and Phase 7's
**export** done 2026-07-27 — three formats, closes #25.
`docs/PLAN.md` is canonical for phase status — trust it over this line):
- `apps/web` — Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel:
  real auth (email+password **and Google OAuth** — #89, 2026-07-20), drag-and-drop
  upload to R2, **Google Drive import** (connect → Picker → `POST /api/imports`;
  popup code flow with NO public callback, tokens AES-GCM in `source_connections`,
  worker streams the bytes — ADR 0025, #97–#103) and **Dropbox import** (Chooser
  drop-in → the same `POST /api/imports`; **zero OAuth** — no connection row, the
  ~4 h direct links ride in the ingest payload and the worker fetches each original
  once into R2 — ADR 0008, #105–#107), a real homepage of project cards,
  and Canvas/Timeline/Map/Topic all rendering the caller's real assets. Work gets **out**
  through one dialog: `POST /api/exports` → an `export` job → a PDF, a captions CSV or a
  ZIP of the files (ADR 0035 + its Amendments). Page order is the canvas reading order,
  not the order the ids happened to arrive in.
  `/` now serves **two** audiences (ADR 0036): `proxy.ts` exempts it by exact
  match and `app/page.tsx` forks on the session — no claims renders the public
  marketing landing (`components/landing/`), a signed-in caller still gets the
  project hub. **Auth is a hardened surface, not a stub:**
  `/auth/callback` runs the PKCE exchange for both email links and Google, validates
  `?next=` through `lib/safe-redirect.ts` (open redirect, #90), and reports failures
  to `/login` as a *code only* — never the provider's own text. Read
  `docs/decisions/0021` before touching it; the obvious "improvement" of rendering
  `error_description` is the vulnerability that ADR exists to prevent.
  **Map is a real geographic map now, not `country` clouds:** MapLibre GL over
  OpenStreetMap vector tiles (OpenFreeMap dark, recoloured) with supercluster over
  each photo's EXIF GPS — thumbnail markers, click a cluster to zoom to its
  expansion, a chip counts the photos with no location (ADR 0027, supersedes the
  Map half of 0018). `photo.country` is now read by no view; it survives only as
  the inert `"Ukraine"` default in `lib/assets.ts`. GPS reaches the map because the
  worker fills `asset_exif.gps_label` offline (GeoNames index + kdbush, ADR 0026)
  and — critically — reads iPhone HEIC EXIF at all: `exifr` throws on those, so
  ingest falls back to `exiftool-vendored` (#113). Topic clusters by `group` =
  the stored semantic cluster label when present (`topic_clusters`, ADR 0028 —
  worker k-means over embeddings; "yoga"/"stretching"/"йога" become one cloud,
  stable across sessions and identical in every project), with the read-time tag
  heuristic (`lib/topics.ts`, ADR 0023) as the fallback for not-yet-clustered
  assets and `Unsorted` for the unanalyzed. **Topic holds itself together now
  (ADR 0038):** a drag override records the cluster it was dropped in
  (`Photo.clusterId` — the id, not the label, so a rename never resets an
  arrangement) and is ignored once that changes, so a re-cluster re-packs those
  tiles instead of stranding them; a cloud's label/backdrop anchor on the
  cloud's *core*, so one far-dragged tile can no longer drag the name into empty
  canvas; **Regroup** (`SortingActionBar`, Topic + Timeline) drops the
  overrides; **Re-cluster** (`POST /api/topics/recluster`, zero credits)
  recomputes the clouds on demand; and **double-clicking a cloud's label renames
  it** (`PATCH /api/topics/[id]` + `topic_clusters.is_renamed` — a pinned name
  survives every re-cluster, and its cluster is never deleted for failing to
  match). Cluster labels are also exempt from the `TOPIC_CLOUD_CAP` "Other"
  fold, which now bounds only the heuristic.
  **Colour labels are the human axis beside that AI one (ADR 0040, migration
  `20260808000001`):** `assets.label` — one of seven macOS colours, single-valued,
  written only by a person. Deliberately NOT a `tags` row: that table feeds the
  Topic heuristic, the connecting-line web and search's explicit tier, so a tag
  named `red` would grow a "red" cloud and answer a text search for the colour.
  One swatch row assigns it from four places (right-click menu, action bar,
  drawer, keys `1`–`7`, `0` clears) through `POST /api/assets/label`. The same
  row **filters** when nothing is selected (`LabelBarControl` on both bottom
  bars — ADR 0040 as amended): the two jobs never overlap, and an empty
  selection is exactly when "mark the selection" has nothing to do. The filter
  **hides tiles without ever moving them** — every layout still runs over the
  full set and the filter is applied at one seam (`visibleTilePositions`), so
  artboards, folders and exports keep seeing the real geometry. **The LABELS
  sorting view is retired** and so is `LabelFilterPanel`; a colour is a marker
  you read on every tile in every view, not a fourth way to sort. The seven
  names stay renameable in the data (`workspace_labels`, `PATCH /api/labels`)
  but have **no UI entry point** — deliberate, recorded in the ADR, don't
  "restore" it as a bug. Zero credits.
  **Sticky notes are server rows now, geometry included (ADR 0041, migration
  `20260808000002`):** `canvas_annotations` — a note (and, next, freehand ink)
  scoped to a project or the `all` canvas. This is the ONE documented exception
  to "canvas layout is client-only" (ADR 0022/0034): a photo exists apart from
  the canvas so its tile position is a per-user preference, but an annotation
  exists nowhere else, so its x/y *is* its content. Nothing else moved — tiles,
  frames and folder boxes are still `localStorage`. Notes render and can be
  created **only on the Canvas (`neural`) view**, behind the same gate
  `FrameOverlay`/`FolderOverlay` already used; that single-view rule is what
  lets an annotation have **no anchor** at all, since there is exactly one
  arrangement it is positioned against. Colour is the ADR 0040 seven (reused,
  not re-picked, so the two swatch rows can't fork); `style` is jsonb parsed by
  zod, so the next knob is a field and not a migration. **Everything a note can
  carry is syntax, not structure** (`lib/notes.ts`): `[ ]`/`[x]` checkboxes, `#`
  titles, `-` bullets, `1.` numbers, `**bold**`, `~~strike~~` — all markdown-ish
  marks the renderer recognises, while the body stays one plain string, which is
  what keeps undo, the autosave debounce and a half-typed line out of a block
  model. **Drawing lives ON the note** (ADR 0041 as amended, 2026-08-12): the
  standalone canvas marker is gone, a note has a pencil mode in its own
  `NoteToolsPanel`, and its strokes sit in `body.strokes` in a fixed 0..1000
  virtual space so the drawing scales with the card. `inkBodySchema` and the
  `kind='ink'` parse in `lib/annotations.ts` are **kept but dormant** — deleting
  them would make an old stroke row parse as a blank sticky note. Nothing writes
  `kind='ink'` any more, and canvas ink drawn before the change is invisible.
  Zero credits.
  **Workspaces are a named file scope (ADR 0044):** a `board` in code
  (`lib/boards.ts`, `hooks/useBoards.ts`, `BoardBrowser` in the header) — a
  named, colour-coded set of a project's files, in the `boards` table since
  migration `20260812000001`. Opening one narrows the canvas and does nothing
  else: notes, folders, artboards, all four views and export keep working. The
  scope is applied at `canvasPhotos()` and mirrored into
  `WorkspaceState.boardScope`, which is the opposite of the label filter on
  purpose — a workspace RE-PACKS, so the geometry seam (`activeTilePositions`)
  and the render seam must run over the same set or a drag lands where nothing
  is drawn. **Every scope keeps its own coordinates** (ADR 0044's 2026-08-17
  amendment): the arrangement is one `localStorage` blob per project *plus* open
  workspace — `lib/canvas-store.ts`, `archivemind:canvas:{projectId}` for the
  project canvas (the unchanged pre-workspace key) and `…:b:{boardId}` for a
  workspace. `switchCanvasScope` flushes the outgoing scope under its own key
  **before** loading the incoming one, because saves are debounced and a drag
  followed by a chip click is exactly what would otherwise be lost; the key
  lives in `WorkspaceState.canvasScope` beside the arrangement so a save can
  never land in the scope you just left. A note is the deliberate exception —
  its geometry is server-held content (ADR 0041), one x/y for both scopes.
  **Deleting one is confirmed, reversible and swept** (ADR 0044's
  2026-08-13 amendment, migration `20260813000001`): the chip's `×` asks, then
  stamps `boards.deleted_at` — `PATCH { deleted: true|false }`, the project
  trash's own idiom — so membership and the notes and folders it owns survive
  and a restore is whole. `DELETE` is now the permanent path, from the Trash
  panel only, and `sweep_trashed_boards()` hard-deletes past 30 days. The undo
  rides on the delete's own toast (the shape every reversible delete uses) —
  **not** a second `↺` in the header, which duplicated the canvas undo's icon a
  few hundred pixels away; trashed workspaces list in the canvas Trash panel
  (not the homepage Trash view — a workspace is scoped to one project, a
  trashed photo is not). **Switching workspace re-frames the canvas** (`Fit`,
  from `useWorkspace`'s `boardScope` effect): a workspace re-packs, so without
  it the camera still points where the previous set was. **The project name in
  the header IS "all files"** — clicking it leaves the open workspace, a caret
  beside it opens the project switcher, and the old `All files` chip is gone
  (two controls, one scope).
  The chat panel IS
  Smart Search (#16): `sendChat` calls `GET /api/search` and renders results in
  relevance tiers — explicit matches (a tag, place, or a lexical hit on the AI
  description/facts) outrank cosine-only rows and read as "strong", the rest
  collapse behind "show more" (ADR 0029). Search is **hybrid**: image-embedding
  cosine + Postgres FTS over description/facts + EXIF filters (camera/ISO/aperture)
  alongside date/place (ADR 0031). `lib/chat.ts` keeps only static help/greeting copy.
  **Usage & Storage** (ADR 0037, 2026-07-27) is the homepage's fifth view, not a
  page of its own — the sidebar item and `/account/usage` both render
  `HomeClient` with `initialView="usage"`, so there is exactly ONE signed-in
  chrome. Add new signed-in surfaces as `ViewMode`s there, not as new layouts.
  It reads one RLS-scoped `workspace_usage()` RPC (`lib/usage.ts` server-side,
  `GET /api/usage` for the client switch) and answers three questions: storage
  by bucket, credits this month, and what is still unanalyzed.
- `apps/worker` — Railway job worker: ai_jobs queue, ingest (dedup/EXIF/previews,
  HEIC + RAW paths), analyze (Gemini tags/facts + embeddings; user-triggered
  only — never automatic), caption (styled multilingual captions — live
  end-to-end since #82: drawer Regenerate/edit/Save per lang × style) and
  cluster (deterministic k-means over image embeddings → `topic_clusters` +
  `assets.cluster_id`; auto-enqueued after analyze, zero Gemini calls so the
  "AI only by button" rule holds — ADR 0028; it also RELABELS a matched cluster
  now unless a human pinned the name via `is_renamed`, and can be triggered by
  the user's own Re-cluster button — ADR 0038) and purge (erase an expired
  trashed asset's R2 bytes + DB derivatives, keep the row as a dedup
  tombstone; enqueued by the 6-hourly `sweep_deleted_assets()` after the
  30-day photo-trash window or by "Delete permanently" — ADR 0033), edit (renders the
  stored crop/rotate recipe into separate previews, ADR 0030) and export. There are
  **seven handlers, one per member of `jobTypeSchema`** — nothing can sit in the queue
  without one.
- `packages/shared` — zod schemas / domain contracts shared by web + worker, plus
  `src/usage.ts`: the **credit unit**. `1 credit = 1 AI action on 1 photo` —
  analyze 1, caption 1 *per language*, and `embedding`/`search_query`/`export`/
  `asset_ingested` **0** (the embedding is the second half of the same analyze
  call; search is the core loop). Storage is a separate axis in bytes, never
  converted to credits. Both the worker (which writes `usage_events`) and the
  web reader (which totals them) import this, so the meter and the future bill
  cannot drift apart. Limits live in the `plans` table and are display-only —
  `plans.enforced` is false everywhere and nothing refuses work (ADR 0037).

Target stack: Supabase (Postgres + Auth + pgvector),
Cloudflare R2 (all binaries), and a **worker on Railway** for heavy jobs
(ingest/analyze/caption/export). AI = `gemini-3.1-flash-lite` via the
`GEMINI_ANALYZE_MODEL` env var for captions/analysis/search + `gemini-embedding-2`
for embeddings (never hardcode a model generation — see `docs/decisions/0010`).

**Before writing any backend code, read the canonical docs — do not infer the
design from this file:**
- `docs/TECH_SPEC.md` (v1.2) — canonical for the domain model (**Asset ≠ File**),
  architecture, schema, models, and security. Single source of truth.
- `docs/PLAN.md` — the phase-by-phase build order (Phase 0–7).
- `docs/decisions/` — the "why" behind each call. **Read an ADR to its end:** several now
  carry `## Amendments` sections that correct the Decision above them (0035 heavily, plus
  0027 and 0033) — the head of the file can state the opposite of what ships. Some ADRs
  also supersede earlier ones in
  part: for the Timeline/Map/Topic views, 0016 → 0017 → 0018 → 0022 → 0023 → 0024,
  with **0027** now superseding the Map half and **0028** the Topic half — read
  **0022** (unified cloud canvas +
  tag-driven connecting lines, now Topic-only), **0023** (tag-derived Topic clouds,
  now the *fallback*), **0028** (Topic clouds cluster by stored embedding k-means —
  the primary source of a photo's Topic now),
  **0024** (Timeline as a per-day date axis; cloud focus/whole-cloud drag),
  **0027** (Map as a real MapLibre geographic map over EXIF GPS; ADR 0026 for the
  offline reverse geocoding that labels it) and **0038** (Topic legibility —
  cluster-anchored overrides, core-anchored labels, Regroup / Re-cluster /
  rename; it amends the label ranking and the label-stability rule in 0028 and
  the "Other" fold in 0023) for what ships today. **0040** is colour labels as a
  human curation axis, and the rule that a label filter hides tiles without
  moving them — **read its amendments**: the LABELS view is retired and the
  filter moved onto the bottom bars. **0041** puts sticky notes on the server
  *with their coordinates* — read it before "correcting" that back to ADR 0022,
  which it deliberately excepts — and **its amendment** moves drawing off the
  canvas and onto the note. **0044** adds Workspaces, a named file scope, and is
  the one ADR here whose backend is still a build list.

Work the tracked GitHub issues in phase order; don't jump ahead of the current
phase.

**How data actually reaches the UI** (the "`lib/api.ts` is the only seam" rule in
ADR 0002 no longer describes reality — this does):
- **Server Components** import server-side readers directly and await them:
  `lib/api.ts` (`getPhotos`), `lib/projects.ts` (`getProjectCards`), `lib/bootstrap.ts`.
- **Client components** never touch the database — they go over HTTP to the route
  handlers in `app/api/*`. That's the client seam, and every write goes through it.
- `hooks/useJobProgress.ts` opens its own Supabase Realtime channel.
Add new reads next to the existing readers, and new writes as route handlers.

## Commands (run from the repo root)
- `pnpm dev` — start dev server (localhost:3000)
- `pnpm build` — production build — MUST pass before merging
- `pnpm lint` — ESLint — MUST pass before merging
- `pnpm typecheck` — typecheck (strict mode) — MUST pass before merging
- `pnpm test` — Vitest unit/contract tests — MUST pass before merging

All five dispatch through turborepo to every workspace package that defines the
script (packages without it are skipped). CI runs them as one job named `checks`:
`pnpm turbo run lint typecheck test build` — a red test blocks merge exactly like
a type error.

The pgTAP suites (`supabase/tests/*.sql`) run in CI as the required `db-tests`
check (fast-skips on PRs that touch neither; full run when `supabase/**` **or**
`apps/worker/src/handlers/**` / `retention.ts` changes — ADR 0020, required since
2026-07-17). The worker paths are in the filter because `supabase/tests/009_export_queries.sql`
EXECUTES the SQL those handlers embed: a TS-only query change shipped
`column ap.byte_size does not exist` to production once already. `supabase test db` locally is the fast pre-flight
when you touch `supabase/**`, not the only line of defence anymore.

## Conventions
- TypeScript strict, no `any`.
- Mockup paths below are relative to **`apps/web/`**.
- Mock/demo data lives in `lib/mock-data.ts` (`lib/chat.ts` is now only static
  help/greeting copy — the canned replies retired with #84). **Known debt:**
  three modules still import `lib/mock-data.ts`
  directly — `lib/format.ts` (STATUS_META), `lib/layout.ts`
  (GROUPS/SOURCES), `components/sidebar/SourceBrowserSidebar.tsx`
  (SOURCES). They're cleaned as their features go real; untracked, no issue yet.
  Don't add new direct imports. (`lib/api.ts` imports it too — that's the seam
  doing its job, not debt.)
- Shared domain types for the mockup live in `apps/web/types/`; reuse them, don't
  redefine inline shapes. Cross-package contracts (web ↔ worker) live in
  `packages/shared` as zod schemas.
- Styling: ported elements intentionally use inline `style={{}}` objects, not
  Tailwind utility classes, to guarantee pixel fidelity to the source design — see
  `docs/decisions/0001-inline-styles-over-tailwind.md`. Tailwind is fine for new,
  non-computed structural styling. **One documented exception:**
  `components/landing/` uses a CSS Module — inline styles can't express the
  sticky/scroll composition, media queries or `prefers-reduced-motion` fallbacks
  a marketing page is made of (ADR 0036). Keep that boundary; don't spread CSS
  Modules into the workspace UI.
- Several behaviors that look like bugs are intentional fidelity to the source
  design (or a deliberate, documented deviation from it) — see
  `docs/decisions/0003-preserve-source-quirks.md` and
  `docs/decisions/0005-functional-project-filtering.md` before "fixing" one.

## Repository etiquette
- Trunk-based: branch from `main`, short-lived branches, squash-merge, delete
  branch after merge. Branch naming: `feat/`, `fix/`, `docs/`, `chore/` + short name.
- Rebase your own branch onto `main` before opening a PR. Never rebase a branch the
  other person has already pulled.
- Conventional commits (feat/fix/chore/docs).
- Full workflow: @CONTRIBUTING.md

## Risk zones
- **Secrets are live — this repo is past the "no backend" stage.** `apps/web/.env.local`
  (untracked) holds real Supabase + R2 credentials; the worker's Railway env holds
  `DATABASE_URL`, R2 keys, and `GEMINI_API_KEY`. Never commit `.env` files or API keys —
  `.gitignore` excludes `.env*` and only `apps/web/.env.example` is tracked; keep it that
  way. `.worktreeinclude` copies `.env.local` into new worktrees, so treat those as
  secret-bearing too. Never paste env values into issues, PRs, or logs.
- Migrations are developed against local Supabase (`supabase db reset` replays them) and
  land on the single EU cloud project, which doubles as shared testing until the first
  external users — so a bad migration hits real infrastructure. **Oleksandr (`slobodskyi`)
  is the migrations owner:** schema changes land PR-only, through him, never ad hoc —
  see @CONTRIBUTING.md.

## See also
- `docs/TECH_SPEC.md` — **canonical** design/architecture/schema (v1.2)
- `docs/PLAN.md` — the Phase 0–7 build order
- @ARCHITECTURE.md — the *current mockup's* data flow + domain glossary
- @CONTRIBUTING.md — git workflow, PR process, review checklist
- `docs/decisions/` — architecture decision records; read before assuming "why"
