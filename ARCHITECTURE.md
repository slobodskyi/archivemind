# Architecture

This file describes the **current mockup** — the thing that runs on `main` today.
For the **target backend** (schema, worker, AI pipeline, security), `docs/TECH_SPEC.md`
(v1.2) is the single source of truth and `docs/PLAN.md` is the build order. Don't
duplicate those here.

## What this is (today)
A pnpm + turborepo monorepo, live in production (Phases 0–4 shipped: upload →
analyze → captions → search). `apps/web` (Vercel) is the ported Claude Design
canvas UI with real auth — email+password **or Google OAuth** (#89) — drag-and-drop
upload to R2, and a canvas that renders the caller's own assets. `apps/worker`
(Railway) processes `ai_jobs`: ingest
(sha256 dedup / EXIF / webp previews, incl. HEIC + RAW-embedded-JPEG paths),
analyze (Gemini tags/facts + 768-dim image embeddings — user-triggered only) and
caption (styled multilingual captions per spec §8.3 — live end-to-end since #82:
drawer Regenerate/edit/Save, `is_edited` guard + confirmed-overwrite unlock).
`packages/shared` holds the zod contracts both sides parse. Projects and all four
canvas views now run on the caller's real assets; Topic clusters by a `group`
DERIVED from each asset's AI tags (`lib/topics.ts`, ADR 0023 — analyzed assets
split into real named clouds, unanalyzed land in Unsorted), while Map still
clusters by the inert `country` default and renders one cloud until a backend
owns that field (ADR 0018). The chat panel is Smart Search
(#16): `sendChat` → `GET /api/search` → ranked results with thumb strip +
select-on-canvas; `lib/chat.ts` keeps only static help/greeting copy.

## Data flow (today — paths relative to `apps/web/`)

```
Supabase Postgres (RLS)  ⇄  apps/worker (Railway): ai_jobs queue —
        |                    ingest → previews/EXIF → R2 · analyze → tags/embeddings
        |                    caption → captions rows (is_edited-guarded upserts)
        |                    retention.ts → sweep_trashed_projects() on boot + 6h
        v
lib/assets.ts · lib/projects.ts · lib/bootstrap.ts
        |                    RLS-scoped selects + presigned R2 preview URLs,
        |                    mapped into the mockup's Photo / ProjectCard shapes
        v
READ PATH (Server Components import these and await them directly):
  app/page.tsx              homepage hub — ensureWorkspace() + getProjectCards()
  app/projects/[id]/page.tsx  canvas — getProjectCards() + lib/api.ts getPhotos()
        |                    ("all" = whole workspace; else the project's M:N assets)
        v
  components/home/HomeClient.tsx · components/workspace/ArchiveWorkspace.tsx

WRITE PATH (client → HTTP → route handlers; nothing client-side touches the DB):
  app/api/uploads/presign · uploads/complete   drag-drop → R2 → ingest job
  app/api/jobs                                 user-triggered analyze / caption
  app/api/projects · projects/[id]             create · rename/archive/trash
  app/api/projects/[id]/assets                 M:N add
  app/api/assets/[id]                          soft delete (status='deleted')
  app/api/assets/[id]/medium                   lazy presigned preview
  app/api/captions/[id]                        caption edit (is_edited) / resetEdited
  app/api/search                               GET §8.4: parse → embed → search_assets()

AUTH PATH (public — proxy.ts lets the whole /auth/* subtree through):
  components/auth/AuthForm.tsx   signInWithPassword · signUp · signInWithOAuth("google")
  app/auth/callback              PKCE exchange for BOTH email links and Google;
                                 ?next= validated by lib/safe-redirect.ts (#90);
                                 failures → /login?auth_error=<code> (code only)
  app/login/page.tsx             async Server Component: reads searchParams and maps
                                 the code through lib/auth-errors.ts to our own copy
                                 (never the provider's text — ADR 0021). Dynamic, not
                                 prerendered, because of that read.
  app/auth/signout · auth/reset  sign out · dead-session escape hatch

hooks/useJobProgress.ts     its own Supabase Realtime channel → job progress
```

**Seams (ADR 0002's "`lib/api.ts` is the only UI→data seam" no longer holds — this
is the real topology).** Server Components import server-side readers directly and
await them: `lib/api.ts` (`getPhotos`), `lib/projects.ts` (`getProjectCards`),
`lib/bootstrap.ts`. Client components never touch the database — they go over HTTP
to the route handlers in `app/api/*`, which is where every write goes; `hooks/
useJobProgress.ts` opens its own Realtime channel. Add new reads beside the existing
readers, new writes as route handlers. (`lib/api.ts`'s `getPhoto`/`getProjects`/
`getGroups`/`getSources` currently have zero callers — dead mocks, not a live seam;
their presence is why readers keep concluding projects/groups/sources are still mock.)

Real assets carry `src/srcMedium` (presigned previews, `lib/img.ts` falls back to a
neutral tile while previews are pending — picsum only ever renders for mock rows).
Some modules still import `lib/mock-data.ts` lookup tables directly (`lib/format.ts`,
`lib/layout.ts`, `components/sidebar/SourceBrowserSidebar.tsx`) — known debt, cleaned
as their features go real. Don't add new direct imports.

## Domain glossary (mockup terms)
These are the mockup's shapes. The **target** model differs — see the note below.

- **Photo** — a single archived image (`types/photo.ts`). Carries EXIF, tags, facts, captions, and a project field.
- **Project** ("archive" in the UI copy) — a real, user-created collection stored as a DB row (`ProjectKey = string`, `types/photo.ts:16`; frontline / travel / client survive only as mock seeds in `PROJECTS_META`). Selecting one navigates to `/projects/[id]` (ADR 0014); the server scopes assets through the `project_assets` M:N join and the canvas renders them directly (ADR 0015). Projects can be renamed, archived or trashed (`PATCH /api/projects/[id]`; trashed ones are hard-deleted after 30 days — ADR 0019). The `all` scope is **not** a project — it's the read-only workspace-wide grid of every active asset.
- **Group** — the Topic view's cloud key. For real assets it is DERIVED from the asset's AI tags (`lib/topics.ts`, ADR 0023): the most-shared viable tag in event → scene → object priority, ambient tags skipped (but an asset whose only thematic tags are ambient keeps one rather than falling to `Other`), top-6 topics keep their name, the rest fold into `Other`, unanalyzed assets → `Unsorted`. Result-set-relative and re-derived on every read (counts run over the current project's newest ≤500 rows) — the same asset can carry different topics in different projects, and topics can move as the corpus grows; the stable replacement is the post-MVP embedding-clustering job (spec §13). The old fixed keys (rescue, aid, urban…) survive only as mock seeds with curated `GROUPS` colors.
- **Source** — where a photo originated. The type union is `gdrive | icloud | dropbox | upload` (`types/photo.ts:1`), but `upload` is the only real one — `lib/assets.ts` stamps it on every real asset. No Drive/Dropbox integration exists (`DataSourcesModal`'s Connect only toasts "coming soon"); no iCloud in MVP. The Neural source-hub/folder drill-down is gone (ADR 0015).
- **View** — one of four, all rendered from `components/canvas/` (the old `components/map/` and the Leaflet dep are gone — ADR 0016→0017→0018→0022→0023→0024). **The internal id and the on-screen label disagree — trust `types/view.ts`, not the screen:** `neural` = "CANVAS", `timeline` = "TIMELINE", `map` = "MAP", `sense` = "TOPIC". All four views render their tiles through one shared `ProjectAssetView` (tiles persist across views and *glide* to new positions when you switch sort). Map/Topic re-sort the same files into `CloudDecor`/`CloudLabels` cloud clusters (by country / topic — not a geo map, ADR 0022); Timeline is a horizontal per-day **date axis** (evenly-spaced `DD/MM/YYYY` columns, files split above/below the axis, drag clamped to the tile's own date column — ADR 0024). Clicking a cloud's label focuses that cloud (others fade; their lines only halfway) and dragging a label moves the whole cloud (ADR 0024). The connecting lines between tiles (Map/Topic; Timeline has none — the axis carries its structure) are real relations: files link by shared AI tags (`photo.tags`, from the analyze job) — unanalyzed files have no lines, and the web is deliberately sparse: ambient tags (>24 files) don't link, each file keeps only its 4 strongest same-cloud links, cross-cloud pairs reduce to one strongest bridge per cloud pair, and tiles dropped on an artboard detach (ADR 0022). Timeline/Map/Topic only render inside a project — in all-files mode only `neural` renders and the tabs hide.
- **Drawer** — the right-side photo detail panel.

> **Target model (TECH_SPEC v1.2 / ADR 0011):** the mockup's flat `Photo` becomes
> **Asset ≠ File** — an `asset` is the canonical entity (one shot/document) and
> `files` are its physical representations; EXIF/tags/captions/facts/embeddings and
> project membership all reference `asset_id`, and projects are **M:N** (a file can
> live in many projects), not the mockup's single project field. Sources become real
> Google Drive / Dropbox integrations (no iCloud in MVP). The rename lands during the
> build phases — see the spec, don't reshape the mockup ahead of it.

## Stack (Phases 0–4 shipped; Phase 5 remainder — canvas at scale — next)
See `docs/TECH_SPEC.md` §2–§3, and `docs/PLAN.md` for live phase status. In brief:
monorepo `apps/web` (Vercel) + `apps/worker` (Railway) + `packages/shared` +
`supabase/`; Supabase Postgres (+ Auth, pgvector, Realtime); Cloudflare R2 for all
binaries; Gemini (`gemini-3.1-flash-lite` + `gemini-embedding-2`) for AI.

**All of this is real, not aspirational.** `apps/worker` runs the ingest + analyze
handlers and the retention sweeper; `packages/shared` holds live zod contracts both
sides parse; `apps/web` has real auth (`proxy.ts` guard + `lib/supabase/` + the
`lib/safe-redirect.ts` / `lib/auth-errors.ts` guards on the callback), route handlers
under `app/api/`, and RLS-scoped reads via `lib/assets.ts` / `lib/projects.ts`.
Network calls, auth and a database client are **expected** here — an earlier version of
this file forbade them, which was true only before Phase 0.

## Key implementation notes (read before "fixing" something)
- Several behaviors that look like bugs are intentional fidelity to the original design spec, or a deliberate documented deviation from it. See `docs/decisions/` for the list before changing them.
- Layout algorithms are pure, deterministic functions in `lib/layout.ts`: per-project asset grid (`assetGallery`), and the circle-packed cloud clusters shared by Timeline (`timelineCloudLayout`, grouped by real capture month), Map (`mapCloudLayout`), and Topic (`topicCloudLayout`) — all via `buildCloudLayout` → `packCircles` (ADR 0022). No `Math.random` on any layout or render path by design — keep it that way for reproducibility. (The one exception is the `crypto.randomUUID` fallback in `lib/upload-client.ts` — an opaque batch key, never a layout input. Don't delete it to "comply": `crypto.randomUUID` is undefined on non-secure-context origins.)
- `components/sidebar/SourceBrowserSidebar.tsx` is mounted by `ArchiveWorkspace` but is **currently unreachable**: `sidebarOpen` derives from `sidebarTabs.length > 0`, and the only function that fills that array (`openSourceTab`) has no callers since #74 removed the canvas source tiles. Its own comments still describe that removed drill-down — don't trust them. Either the entry point comes back or the surface goes; don't assume it works.
