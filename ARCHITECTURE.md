# Architecture

This file describes the **current mockup** — the thing that runs on `main` today.
For the **target backend** (schema, worker, AI pipeline, security), `docs/TECH_SPEC.md`
(v1.2) is the single source of truth and `docs/PLAN.md` is the build order. Don't
duplicate those here.

## What this is (today)
A pnpm + turborepo monorepo, live in production (Phases 0–4 shipped: upload →
analyze → captions → search). `apps/web` (Vercel) is the ported Claude Design
canvas UI with real auth — email+password **or Google OAuth** (#89) — drag-and-drop
upload to R2, **Google Drive import** (#99–#101: connect + Picker + `/api/imports`,
ADR 0025), and a canvas that renders the caller's own assets. `apps/worker`
(Railway) processes `ai_jobs`: ingest
(sha256 dedup / EXIF / webp previews, incl. HEIC + RAW-embedded-JPEG paths),
analyze (Gemini tags/facts + 768-dim image embeddings — user-triggered only),
caption (styled multilingual captions per spec §8.3 — live end-to-end since #82:
drawer Regenerate/edit/Save, `is_edited` guard + confirmed-overwrite unlock) and
cluster (deterministic k-means over the image embeddings → `topic_clusters` +
`assets.cluster_id`; enqueued automatically after analyze, zero Gemini calls —
ADR 0028).
`packages/shared` holds the zod contracts both sides parse. Projects and all four
canvas views now run on the caller's real assets; Topic clusters by a `group` that
is the stored semantic cluster label when present (`topic_clusters`, ADR 0028 —
"yoga"/"stretching"/"йога" become one cloud, stable across sessions and identical
in every project), falling back to the read-time tag heuristic for not-yet-clustered
assets (`lib/topics.ts`, ADR 0023) and to Unsorted when untagged, while Map is now a
real geographic map — MapLibre GL over recoloured OpenStreetMap vector tiles,
superclustering each photo's EXIF GPS into thumbnail markers, geotagged photos
only (ADR 0027, superseding 0018's inert country cloud; the worker labels those
coordinates offline via ADR 0026, and reads iPhone HEIC EXIF at all only since
the `exiftool-vendored` fallback in #113). The chat panel is Smart Search
(#16): `sendChat` → `GET /api/search` → results in relevance tiers (explicit
tag/place/lexical matches read as "strong", cosine-only ones collapse behind
"show more" — ADR 0029) with thumb strip + select-on-canvas. Search is hybrid:
image-embedding cosine + Postgres FTS over the AI description/facts + EXIF
filters (camera/ISO/aperture) beside date/place (ADR 0031). `lib/chat.ts` keeps
only static help/greeting copy.

## Data flow (today — paths relative to `apps/web/`)

```
Supabase Postgres (RLS)  ⇄  apps/worker (Railway): ai_jobs queue —
        |                    ingest → previews/EXIF → R2 · analyze → tags/embeddings
        |                    caption → captions rows (is_edited-guarded upserts)
        |                    cluster → topic_clusters + assets.cluster_id (k-means; after analyze)
        |                    purge → R2 bytes + DB derivatives of expired trash erased,
        |                            assets row kept as dedup tombstone (ADR 0033)
        |                    retention.ts → sweep_trashed_projects() + sweep_deleted_assets()
        |                                   on boot + 6h (the latter enqueues purge jobs)
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
  app/api/assets/[id]                          soft delete (status='deleted'; DB trigger stamps deleted_at)
  app/api/assets/delete · restore · purge      bulk trash ops (ADR 0033): move a selection to
                                               Trash · undo/Restore it (purged excluded) ·
                                               enqueue the permanent purge job
  app/api/assets?scope=trash                   GET: the Trash view's photo list (thumb +
                                               deletedAt countdown; un-purged trash only)
  app/api/assets/[id]/medium                   lazy presigned preview (?original=1 skips the edit)
  app/api/assets/[id]/edit                     image edit (ADR 0030): POST enqueue 'edit' job ·
                                               GET current recipe · DELETE reset. Non-destructive —
                                               asset_previews untouched; worker renders edited
                                               previews from the original medium into asset_edits
  app/api/captions/[id]                        caption edit (is_edited) / resetEdited
  app/api/search                               GET §8.4: parse → embed → search_assets()
                                               (hybrid: cosine + FTS on description/facts,
                                               tiered; date/place/EXIF filters — ADR 0029/0031)
  app/api/integrations/google · /connect       Drive connect: status/revoke · popup-code
                                               exchange → AES-GCM tokens (ADR 0025;
                                               token custody: lib/integrations/*, the
                                               ONLY importer of lib/supabase/admin —
                                               ESLint-fenced)
  app/api/imports                              picked cloud files → assets+files → ONE
                                               ingest job. gdrive (ADR 0025): caller's own
                                               connection, r2_key null, worker streams the
                                               bytes, originals never in R2. dropbox (ADR
                                               0008): connection-less, the ~4 h direct links
                                               ride in the job payload, worker fetches each
                                               original once INTO R2

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
- **Project** ("archive" in the UI copy) — a real, user-created collection stored as a DB row (`ProjectKey = string` in `types/photo.ts`; frontline / travel / client survive only as mock seeds in `PROJECTS_META`). Selecting one navigates to `/projects/[id]` (ADR 0014); the server scopes assets through the `project_assets` M:N join and the canvas renders them directly (ADR 0015). Projects can be renamed, archived or trashed (`PATCH /api/projects/[id]`; trashed ones are hard-deleted after 30 days — ADR 0019). The `all` scope is **not** a project — it's the read-only workspace-wide grid of every active asset.
- **Group** — the Topic view's cloud key. For real assets it is the **stored semantic cluster label** when the asset has one: the `cluster` worker job runs deterministic k-means over the image embeddings and writes `topic_clusters` + `assets.cluster_id`, labelling each cluster by its most discriminative tags (ADR 0028). These clusters are **stable across sessions and identical in every project** of a workspace — "yoga"/"stretching"/"йога" merge into one cloud — and `lib/assets.ts` reads the label through an embedded `topic_clusters ( label )` join (RLS nulls a cross-workspace cluster, so the join only ever surfaces the caller's own labels). When an asset has no cluster yet (analyzed but not clustered, or added after the last run), `deriveTopics` (`lib/topics.ts`) falls back to the **tag heuristic** (ADR 0023): the most-shared viable tag in event → scene → object priority, ambient tags skipped (but an asset whose only thematic tags are ambient keeps one rather than falling to `Other`), unanalyzed assets → `Unsorted`. Cluster labels and heuristic topics fold together through the shared top-6 + Other cap. The heuristic fallback is result-set-relative (counts run over the current project's newest ≤500 rows); the cluster labels are not — they are computed once over the whole workspace. The old fixed keys (rescue, aid, urban…) survive only as mock seeds with curated `GROUPS` colors.
- **Source** — where a photo originated. The type union is `gdrive | icloud | dropbox | upload` (`types/photo.ts:1`); `upload`, `gdrive` **and `dropbox` are real** — `lib/assets.ts` stamps all three from `files.origin`, and `lib/img.ts`'s `isRealSource` (`REAL_SOURCES` = upload/gdrive/dropbox) is the real-vs-mock gate; only `icloud` survives as a mock seed. Google Drive is a full integration since 2026-07-21 (#99–#101: popup code flow + encrypted tokens in `source_connections`, Picker multiselect → `POST /api/imports`, worker streams bytes — ADR 0025), and Dropbox since the same day (#105–#107): connection-less by design — the Chooser (`lib/dropbox-chooser.ts`) runs on the user's own dropbox.com session and returns ~4 h direct links, which ride in the ingest payload so the worker fetches each original once **into R2** (ADR 0008). No iCloud in MVP. The Neural source-hub/folder drill-down is gone (ADR 0015).
- **View** — one of four (the old `components/map/` and the Leaflet dep are gone — ADR 0016→0017→0018→0022→0023→0024; Map then came *back* as a real geographic map, ADR 0027). **The internal id and the on-screen label disagree — trust `types/view.ts`, not the screen:** `neural` = "CANVAS", `timeline` = "TIMELINE", `map` = "MAP", `sense` = "TOPIC". The three tile views — Canvas, Timeline, Topic — render through one shared `ProjectAssetView` from `components/canvas/` (tiles persist across them and *glide* to new positions when you switch sort); **Map is the exception, its own MapLibre GL map in `components/map/` rather than a tile surface** (photo-thumbnail markers superclustered over each photo's EXIF GPS on recoloured OpenStreetMap vector tiles, geotagged photos only with a chip counting the rest, ADR 0027). Topic re-sorts the same files into `CloudDecor`/`CloudLabels` cloud clusters (by semantic cluster label, tag heuristic as fallback — not a geo map, ADR 0028/0023/0022); Timeline is a horizontal per-day **date axis** (evenly-spaced `DD/MM/YYYY` columns, files split above/below the axis, drag clamped to the tile's own date column — ADR 0024). Clicking a cloud's label focuses that cloud (others fade; their lines only halfway) and dragging a label moves the whole cloud (Topic; ADR 0024). The connecting lines between tiles (Topic only — Map's geography and Timeline's date axis carry their structure instead) are real relations: files link by shared AI tags (`photo.tags`, from the analyze job) — unanalyzed files have no lines, and the web is deliberately sparse: ambient tags (>24 files) don't link, each file keeps only its 4 strongest same-cloud links, cross-cloud pairs reduce to one strongest bridge per cloud pair, and tiles dropped on an artboard detach (ADR 0022). Timeline/Map/Topic only render inside a project — in all-files mode only `neural` renders and the tabs hide.
- **Drawer** — the right-side photo detail panel. Its preview carries an **Edit** button (real sources with previews) that opens the **image editor** (`components/editor/ImageEditor.tsx`) — Tier-0 non-destructive crop/rotate/straighten/flip (ADR 0030). The client only builds a `recipe`; the worker renders the edited previews. An edited asset shows "Edited" and offers Revert. The opposite corner carries the **Delete** pill (ADR 0033) — Move to Trash with the same undo toast as the tile/action-bar/right-click deletes; a big selection confirms first, and the homepage Trash view is where photos are restored or purged for good.

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
+ caption + cluster handlers and the retention sweeper; `packages/shared` holds live zod contracts both
sides parse; `apps/web` has real auth (`proxy.ts` guard + `lib/supabase/` + the
`lib/safe-redirect.ts` / `lib/auth-errors.ts` guards on the callback), route handlers
under `app/api/`, and RLS-scoped reads via `lib/assets.ts` / `lib/projects.ts`.
Network calls, auth and a database client are **expected** here — an earlier version of
this file forbade them, which was true only before Phase 0.

## Key implementation notes (read before "fixing" something)
- Several behaviors that look like bugs are intentional fidelity to the original design spec, or a deliberate documented deviation from it. See `docs/decisions/` for the list before changing them.
- Layout algorithms are pure, deterministic functions in `lib/layout.ts`: per-project asset grid (`assetGallery`), the circle-packed cloud clusters of Topic (`topicCloudLayout`) via `buildCloudLayout` → `packCircles` (ADR 0022), and the Timeline's per-day date axis (`timelineAxisLayout` — no packing, fixed evenly-spaced columns; ADR 0024). Map's clustering moved OUT of `lib/layout.ts` into MapLibre GL + supercluster (ADR 0027) — `mapCloudLayout`/`mapCloudColor`/the `COUNTRY_LATLON` import were deleted. supercluster is deterministic too (no `Math.random`), so the rule below still holds. No `Math.random` on any layout or render path by design — keep it that way for reproducibility. (The one exception is the `crypto.randomUUID` fallback in `lib/upload-client.ts` — an opaque batch key, never a layout input. Don't delete it to "comply": `crypto.randomUUID` is undefined on non-secure-context origins.)
- `components/sidebar/SourceBrowserSidebar.tsx` is mounted by `ArchiveWorkspace` but is **currently unreachable**: `sidebarOpen` derives from `sidebarTabs.length > 0`, and the only function that fills that array (`openSourceTab`) has no callers since #74 removed the canvas source tiles. Its own comments still describe that removed drill-down — don't trust them. Either the entry point comes back or the surface goes; don't assume it works.
