# Architecture

This file describes the **current mockup** — the thing that runs on `main` today.
For the **target backend** (schema, worker, AI pipeline, security), `docs/TECH_SPEC.md`
(v1.2) is the single source of truth and `docs/PLAN.md` is the build order. Don't
duplicate those here.

## What this is (today)
A pnpm + turborepo monorepo, live in production (Phases 0–4 shipped: upload → analyze → captions → search;
Phase 6's cloud imports 2026-07-21; Phase 7's export 2026-07-27). `apps/web` (Vercel) is the ported Claude Design
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
ADR 0028), edit (ADR 0030) and export (ADR 0035 + its Amendments): one handler,
three deliverables — `options.format` picks `pdf` (a laid-out document),
`captions_csv` (one row per photo, because a PDF page cannot be pasted into an
agency's caption field) or `zip` (the files themselves). It stores the artifact
in R2 and writes back its **key**, never a presigned URL: `ai_jobs.payload` is
readable by every workspace member and its UPDATE fires the Realtime broadcast,
so a URL parked there both leaked to everyone and rotted on its TTL.
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
        |                    edit → edited previews rendered from the medium into
        |                           asset_edits; asset_previews untouched (ADR 0030)
        |                    purge → R2 bytes + DB derivatives of expired trash erased,
        |                            assets row kept as dedup tombstone (ADR 0033) — plus
        |                            every export artifact that embedded the photo, since
        |                            a PDF carries a JPEG of it and leaving that is not erasure
        |                    export → pdf | captions_csv | zip → R2; only the KEY lands in
        |                             payload.result_key, the route presigns per request (ADR 0035)
        |                    retention.ts → sweep_trashed_projects() + sweep_trashed_boards() +
        |                                   sweep_deleted_assets() + sweepExpiredExports() on boot
        |                                   + 6h (the 3rd only enqueues purge jobs; the 4th is no
        |                                   SQL function and is the one sweep that deletes R2
        |                                   objects itself — export artifacts past
        |                                   EXPORT_RETENTION_DAYS, key and all. The 2nd is where a
        |                                   trashed Workspace finally goes, 30 days on — ADR 0044)
        v
lib/assets.ts · lib/projects.ts · lib/bootstrap.ts
        |                    RLS-scoped selects + presigned R2 preview URLs,
        |                    mapped into the mockup's Photo / ProjectCard shapes
        v
READ PATH (Server Components import these and await them directly):
  app/page.tsx              "/" forks on the session (ADR 0036): no claims →
                            components/landing/ (public marketing page; proxy.ts
                            exempts "/" by exact match); signed in → homepage hub
                            — ensureWorkspace() + getProjectCards()
  app/projects/[id]/page.tsx  canvas — getProjectCards() + lib/api.ts getPhotos()
        |                    ("all" = whole workspace; else the project's M:N assets)
        |                    + getCanvasGroups() + getCanvasAnnotations() (ADR 0041:
        |                    sticky notes are server rows now, so they are in the
        |                    first paint rather than fetched after mount)
  app/account/usage/page.tsx  Usage & Storage (ADR 0037) — NOT its own layout:
        |                    renders HomeClient with initialView="usage", so the
        |                    sidebar/shell are the homepage's. lib/usage.ts
        |                    getWorkspaceUsage() → ONE workspace_usage() RPC
        |                    (SECURITY INVOKER, RLS is the boundary) returning
        |                    storage by bucket, credits this month, the
        |                    analyzed/captioned funnel, per-project and
        |                    per-source attribution, 30 days of activity.
        |                    The sidebar's own "Usage & Storage" item switches
        |                    view in place and fetches GET /api/usage instead.
        |                    Both account menus link to the route;
        |                    Settings/Billing still toast, so they stay buttons
        v
  components/home/HomeClient.tsx · components/workspace/ArchiveWorkspace.tsx
  components/account/UsageView.tsx  (a view BODY — no page chrome of its own)

WRITE PATH (client → HTTP → route handlers; nothing client-side touches the DB):
  app/api/uploads/presign · uploads/complete   drag-drop → R2 → ingest job
  app/api/jobs                                 user-triggered analyze / caption
  app/api/projects · projects/[id]             create · rename/archive/trash
  app/api/projects/[id]/assets                 M:N add. Also the Copy/Paste target: Copy parks the
                                               selection's ids in localStorage and Paste links them
                                               into the project being viewed. NOT a duplicate — assets
                                               are deduped by a UNIQUE content_hash index, so a second
                                               row over the same bytes cannot exist, and M:N membership
                                               is what "the same shot in two archives" already means
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
  app/api/assets/[id]/exif                     manual metadata correction (ADR 0039): PATCH writes
                                               asset_exif's OWN columns — so a corrected date moves
                                               the tile on the Timeline and a corrected camera answers
                                               that search filter, with no reader changed. DELETE
                                               reverts from the original_values snapshot. edited_fields
                                               records provenance AND stops the ingest upsert from
                                               overwriting a correction on a re-ingest
  app/api/assets/label                         POST: set/clear the colour label on a selection
                                               (ADR 0040, migration 20260808000001). Bulk-first and
                                               `label: null` clears — re-picking a photo's own colour
                                               sends exactly that. No new RLS: assets_update
                                               (is_editor) already gates it, same as the soft delete.
                                               Zero credits — no model runs
  app/api/labels                               GET/PATCH the workspace's seven colour NAMES
                                               (workspace_labels). Only renamed colours have a row;
                                               an empty name deletes the override, which is the
                                               reset-to-default path. Read by any member, written by
                                               editors
  app/api/topics/[id]                          PATCH: rename one Topic cloud (ADR 0038).
                                               Sets label + is_renamed and NOTHING else —
                                               migration 20260727000003 revoked the blanket
                                               UPDATE grant and re-granted those two columns
                                               (centroid is the k-means stability anchor), so
                                               one extra key in the body is a 42501, not a
                                               silent no-op. A pinned name survives every
                                               re-cluster; its cluster is never deleted for
                                               failing to match
  app/api/topics/recluster                     POST: re-run the workspace's clustering now
                                               (ADR 0038). Its own route, not an arm of
                                               createJobRequestSchema — that union is
                                               asset-id-shaped, this job is workspace-scoped
                                               (same reason edit/purge/export have routes).
                                               Zero credits; queued|running backlog guard;
                                               workspace_id comes from the server, never the
                                               body
  app/api/captions/[id]                        caption edit (is_edited) / resetEdited
  app/api/facts/[id]                           PATCH one fact's status (+ confirmed_by/at).
                                               NOT bookkeeping: caption.ts prompts with
                                               `facts where status='confirmed'`, so this is
                                               the only user-supplied ground truth that
                                               reaches caption generation
  app/api/canvas-groups · /[id] · /[id]/assets canvas folders + artboards + bound GROUPS (ADR 0034;
                                               'group' added by migration 20260805000002 — a bound set
                                               that selects/moves/edits as one, no container drawn.
                                               It shipped in localStorage and moved here because the
                                               ADR-0034 line is "membership is data, geometry is a
                                               per-user override", and a bound set is pure membership):
                                               create/list ·
                                               rename/reorder/delete · add/remove members. Server owns
                                               membership + order; geometry stays in localStorage (ADR 0022).
                                               Read seam: lib/canvas-groups.ts (getCanvasGroups)
  app/api/annotations · /[id]                  sticky notes — and later freehand ink — on the Workspace
                                               canvas (ADR 0041, migration 20260808000002). POST create ·
                                               PATCH move/resize/retype/recolour · DELETE. The ONE canvas
                                               object that carries its GEOMETRY on the server: a photo
                                               exists independently and its tile position is a per-user
                                               view preference, but an annotation exists nowhere else, so
                                               x/y IS its content. Nothing else about layout moved — the
                                               ADR 0022/0034 split still holds for tiles, frames and
                                               folder boxes. The PATCH is deliberately sparse (typing
                                               sends body, a drag sends x/y) so two tabs can't clobber
                                               each other. Read seam: lib/annotations.ts
  app/api/boards · /[id] · /[id]/assets        Workspaces (ADR 0044, migrations 20260812000001 +
                                               20260813000001): create/list · rename/recolour/reorder,
                                               PATCH { deleted: true|false } to trash and restore ·
                                               add/remove members. The DELETE verb is the PERMANENT
                                               one and only the Trash panel calls it — the chip's ×
                                               asks, then stamps deleted_at, so membership and the
                                               notes and folders the workspace owns survive and a
                                               restore is whole. GET returns live AND trashed rows
                                               (splitBoards separates them: the header needs to know
                                               on first paint that there is something to undo).
                                               sweep_trashed_boards() hard-deletes past 30 days.
                                               Read seam: lib/boards-server.ts (getBoards)
  app/api/exports                              artboard/selection → PDF | captions.csv | ZIP (ADR 0035
                                               + its Amendments): POST enqueues an 'export' job; the
                                               worker renders the requested `format` into R2
                                               {ws}/exports/{job_id}.{ext} and writes that KEY to
                                               payload.result_key — GET ?jobId= presigns it per request,
                                               so no bearer URL is stored or broadcast. Artifacts are
                                               swept after EXPORT_RETENTION_DAYS, and purge.ts erases
                                               any that contain an erased photo
  app/api/usage                                GET: the Usage view's snapshot when the
                                               sidebar switches to it client-side (ADR 0037).
                                               Same RPC the Server Component awaits — this
                                               adds only the transport
  app/api/workspace                            GET/PATCH the workspace credit block — creator ·
                                               credit · copyright · usage terms (migration
                                               20260727000001). Not settings trivia: it is the
                                               byline the deliverables carry (the PDF's footer and
                                               cover, the ZIP's README rights block), and since the
                                               app has no settings page the export dialog is its
                                               only editor. RLS is the gate — read by any member,
                                               written only by the owner
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
- **Group** — the Topic view's cloud key. For real assets it is the **stored semantic cluster label** when the asset has one: the `cluster` worker job runs deterministic k-means over the image embeddings and writes `topic_clusters` + `assets.cluster_id`, labelling each cluster by its most *representative and* discriminative tags — score = support × lift, medium/format words demoted, second tag only if it earns it (ADR 0028 as amended by **ADR 0038**, which is why a cluster of screenshots stopped being called "book cover · price tag"). These clusters are **stable across sessions and identical in every project** of a workspace — "yoga"/"stretching"/"йога" merge into one cloud — and `lib/assets.ts` reads the label through an embedded `topic_clusters ( label )` join (RLS nulls a cross-workspace cluster, so the join only ever surfaces the caller's own labels). When an asset has no cluster yet (analyzed but not clustered, or added after the last run), `deriveTopics` (`lib/topics.ts`) falls back to the **tag heuristic** (ADR 0023): the most-shared viable tag in event → scene → object priority, ambient tags skipped (but an asset whose only thematic tags are ambient keeps one rather than falling to `Other`), unanalyzed assets → `Unsorted`. The top-6 + Other cap now bounds **only** those heuristic topics: a stored cluster label always keeps its own cloud (ADR 0038), because the heuristic is result-set-relative (counts run over the current project's newest ≤500 rows) while the clusters are not — they are computed once over the whole workspace, so folding one meant a photo's stable semantic home depended on which project you opened. A cloud can also be **renamed** by the user (double-click its label → `PATCH /api/topics/[id]`; `topic_clusters.is_renamed` pins it against every future re-cluster) and **re-clustered on demand** (`POST /api/topics/recluster`, zero credits). The old fixed keys (rescue, aid, urban…) survive only as mock seeds with curated `GROUPS` colors.
- **Source** — where a photo originated. The type union is `gdrive | icloud | dropbox | upload` (`types/photo.ts:1`); `upload`, `gdrive` **and `dropbox` are real** — `lib/assets.ts` stamps all three from `files.origin`, and `lib/img.ts`'s `isRealSource` (`REAL_SOURCES` = upload/gdrive/dropbox) is the real-vs-mock gate; only `icloud` survives as a mock seed. Google Drive is a full integration since 2026-07-21 (#99–#101: popup code flow + encrypted tokens in `source_connections`, Picker multiselect → `POST /api/imports`, worker streams bytes — ADR 0025), and Dropbox since the same day (#105–#107): connection-less by design — the Chooser (`lib/dropbox-chooser.ts`) runs on the user's own dropbox.com session and returns ~4 h direct links, which ride in the ingest payload so the worker fetches each original once **into R2** (ADR 0008). No iCloud in MVP. The Neural source-hub/folder drill-down is gone (ADR 0015).
- **Annotation** — something a person put *on* the canvas rather than in the archive: a **sticky note** (`canvas_annotations`, ADR 0041, migration `20260808000002`). The one canvas object that carries its **geometry on the server**, and the documented exception to ADR 0022/0034: a photo exists independently of the canvas, so its tile position is a per-user view preference and stays in `localStorage`; an annotation exists nowhere else, so its position *is* its content — a note at no particular place is not a note. Nothing else about layout moved. Notes render and can be created **only on the Canvas (`neural`) view** — the same gate `FrameOverlay`/`FolderOverlay` already sat behind — because the sorting views arrange the same tiles differently, each in its own `GalleryOverrides` bucket, so a note positioned against one arrangement means nothing over another. That single-view rule is also why an annotation needs **no anchor**: it never follows a tile (drag a photo out from under a circle and the circle stays), and so can never go stale the way an ADR 0038 cloud override can. Colour is the ADR 0040 **seven**, reused rather than re-picked so the note swatch and the label swatch can't fork — `noteSurface()` mixes it toward paper, because an 8px dot and a 180px card need the same hue at different weights. `style` is jsonb parsed by `noteStyleSchema`, so a new knob is a zod field and not a migration. Writes are optimistic and sparse (typing debounces a `body` PATCH, a drag PATCHes x/y on release); undo/redo runs `reconcileNotes`, which re-INSERTs a note the undo brought back — its old uuid is gone — and adopts the new id in place. A note is **configurable** through `NoteToolsPanel`, pinned to its left edge (it replaced `NoteOptionsPopover`): paper colour (the same `LabelSwatchRow` the photo pickers use, with `clearable={false}` — a note has no unset colour), a type/pencil mode toggle, then the tools for the active mode. Font size is three steps (`s`/`m`/`l`, the middle one the 12.5px it always was) cycled on one button, and a corner handle resizes the card between 120 and 4000 units, clamped inside the schema's own bounds so the server never rejects a drag the UI allowed. **Everything the body carries is syntax, not structure** (`lib/notes.ts`): `[ ]`/`[x]` checkboxes, `#` titles, `-` bullets, `1.` numbers, `**bold**` and `~~strike~~` are markdown-ish marks the renderer recognises, so the body stays one plain string and undo, the autosave debounce and a half-typed line never learn about a block model. The body renders as text-with-checkboxes until you click into it, when it becomes the raw textarea; clicking a box ticks it *without* opening the editor. The card carries `data-note-surface` because that rendered body is a plain div — the canvas long-press guard keys on it, or a hold on a note would open the canvas menu over it. **Drawing lives ON the note** (ADR 0041 as amended, 2026-08-12): the standalone canvas marker and eraser are gone, and a note's strokes are `body.strokes`, in a fixed **0..1000 virtual space** per note that the SVG stretches with `preserveAspectRatio="none"` — which is what makes a drawing survive a resize, since the stored numbers never depend on the card's size at draw time. `lib/ink.ts` still holds the pure geometry — RDP simplification, Catmull-Rom → cubic beziers, pressure banding, point-to-polyline distance for the eraser — deterministic, same rule as `lib/layout.ts`; `NoteInkLayer` is its only caller. A stroke is bound to **the pointer that started it**, so a palm landing mid-sentence can neither reset it nor commit it, and `getCoalescedEvents()` keeps a fast stroke from arriving as a polygon. The live stroke is written straight onto its `<path>` node — a 120 Hz Pencil must not be 120 renders a second. Once a note has strokes the **"Type a note…" placeholder is suppressed in every mode**, not just while the pencil is down: an empty `text` stops meaning an empty note the moment something is drawn on it, and the hint printed through a drawing reads as a rendering fault. The old `kind='ink'` rows are **dormant, not gone**: `inkBodySchema` and the `kind` branch in `lib/annotations.ts` are kept on purpose, because dropping them would make a stroke row parse as a blank sticky note. Nothing writes `kind='ink'` any more and nothing renders it, so ink drawn on the canvas before the change is invisible.
- **Workspace** (a `board` in code, so it cannot be confused with the tenant `workspace_id`) — a named, colour-coded set of a project's files (`lib/boards.ts`, `hooks/useBoards.ts`, ADR 0044). A `boards` row since migration `20260812000001`; the header's `BoardBrowser` is a chip per workspace, and **the project name to its left is the "all files" scope** — clicking it leaves the open workspace, while a caret beside it opens the project switcher (the `All files` chip that used to say the same thing is gone; on the workspace-wide `all` canvas the control stays a plain switcher). A new workspace takes the lowest free `Workspace N` and the first unused colour, both reserved by creates still in flight, so a double-click on `＋` cannot mint two identical ones. Opening one **narrows the canvas to its files and does nothing else** (bar one signal: the background grid switches from dots to ruled lines, so a narrowed canvas never looks like a full one) — notes, folders, artboards, all four views, export and the label filter behave exactly as with none open. The scope is applied at `canvasPhotos()`, the set every layout reads, and mirrored into `WorkspaceState.boardScope`. That is the **opposite** of the label filter and the difference is the point: a filter hides tiles and leaves every position intact (`visibleTilePositions`, the render seam), whereas a workspace has to RE-PACK, or six photos sit at the coordinates they had among four hundred. Re-packing means the geometry seam (`activeTilePositions` — drags, folder drops, artboard membership, export order) and the render seam must run over the same set, or a drag lands where nothing is drawn. An open workspace with no files gets its own empty state, gated ahead of the project-empty one. **Switching workspace re-frames the canvas** — the same fit the `Fit` button performs, run from an effect on the committed `boardScope` (never on the `activeBoardId` prop, which changes a render earlier and would frame the set you just left). Re-packing is exactly why: without it the camera still points at coordinates that belonged to the previous set, so six photos out of four hundred land off-screen and the canvas reads as empty. A membership change does not re-fit (the ref keeps it to real switches — yanking the camera as a file is dropped on a chip would be its own bug), and neither does opening an empty workspace, which has nothing to frame. **Deleting one is a three-part affair** (ADR 0044 amended 2026-08-13, migration `20260813000001`), because the `×` that does it sits on the chip you click to *open* a workspace: it asks first (`ConfirmModal`, naming what survives), it stamps `boards.deleted_at` instead of removing the row (`PATCH { deleted: true }` — the project trash's own idiom; membership stays and the notes and folders keep pointing at it, which is what makes a restore whole rather than a name over an empty canvas), and the undo rides on that delete's **own toast** (`Undo` beside "*Name* moved to Trash"), the shape every reversible delete already uses — deliberately not a second `↺` in the header, which read as a duplicate of the canvas undo a few hundred pixels away rather than as a different job. `DELETE /api/boards/[id]` is now the permanent path and is reachable only from the Trash panel, where trashed workspaces list above the trashed photos; that panel and not the homepage Trash view, because a workspace belongs to one project while a trashed photo is workspace-global. `sweep_trashed_boards()` hard-deletes past the 30-day window on the worker's usual sweep, and only then do the FK side-effects (membership cascade, `board_id` nulled) run.
- **Label** — a **colour label**: one of seven macOS colours a *person* puts on a photo (`assets.label`, ADR 0040, migration `20260808000001`). Deliberately not a tag: `tags` is the analyze handler's output and feeds the Topic heuristic (ADR 0023), the connecting-line web (ADR 0022) and search's explicit tier (ADR 0029/0031), so a row named `red` in there would grow a "red" cloud, wire every marked photo together, and answer a text search for the colour. Single-valued, because a tile has to be able to answer which colour it carries with one value — the retired LABELS view needed it to pack a cloud, and the filter still needs it to decide what to hide. Assigned from one swatch row that appears in four places — the top of the right-click menu, both bottom action bars, the drawer, and the keys `1`–`7` (`0` clears; bare digits, since `⌘1`–`⌘7` switches browser tabs) — all funnelling through `POST /api/assets/label` with an Undo toast that restores each photo's *previous* colour. The seven names are still renameable per workspace in the data (`workspace_labels`, `PATCH /api/labels`; only renamed colours have a row, the defaults live in `packages/shared`) but have **no UI entry point** since the filter panel and the LABELS view were retired — deliberate, recorded in ADR 0040's amendments, not a control that went missing. Costs no credits (ADR 0037: a credit is one AI action on one photo; no model runs here).
- **Label filter** — the colour control on the bottom bars (`LabelBarControl`, shared by `WorkspaceActionBar` and `SortingActionBar`) narrows the canvas to one colour, or to `No label` (the untriaged pile — a real thing to ask for, which is why the filter type is `AssetLabel | "none" | null`). It **hides tiles, never moves them**: every layout still runs over the full photo set and the filter is applied at one seam (`visibleTilePositions` in `hooks/useWorkspace.ts`), so a marquee can't grab what it can't see and the minimap stops plotting it, while artboard membership, folder contents, frame counts and exports keep seeing the real geometry. Clearing it puts everything back exactly where it was. Per session, never persisted. Applying one narrows the selection to what survives, so "Move 40 to Trash" can't act on photos nobody can see; filtering everything away gets its own empty state with a Clear filter button. The control is **context-sensitive** (ADR 0040 amended): with a selection the swatch row marks it, with none it filters — the two never overlap. `LabelSwatchRow`'s `none` swatch (a hollow dashed ring) is what makes the untriaged pile reachable at all, and is deliberately not the ✕, which clears the filter.
- **View** — one of four (the old `components/map/` and the Leaflet dep are gone — ADR 0016→0017→0018→0022→0023→0024; Map then came *back* as a real geographic map, ADR 0027). **The internal id and the on-screen label disagree — trust `types/view.ts`, not the screen:** `neural` = "CANVAS", `timeline` = "TIMELINE", `map` = "MAP", `sense` = "TOPIC". (A fifth, `labels`, was retired — ADR 0040 as amended.) They are chosen from **`ViewSwitcher`, a bottom-centred segmented control**, which replaced both the header `ViewTabs` and the separate `WorkspaceToggle` that used to hold CANVAS apart from its peers. The three tile views — Canvas, Timeline, Topic — render through one shared `ProjectAssetView` from `components/canvas/` (tiles persist across them and *glide* to new positions when you switch sort); **Map is the exception, its own MapLibre GL map in `components/map/` rather than a tile surface** (photo-thumbnail markers superclustered over each photo's EXIF GPS on recoloured OpenStreetMap vector tiles, geotagged photos only with a chip counting the rest, ADR 0027). Topic re-sorts the same files into `CloudDecor`/`CloudLabels` cloud clusters (by semantic cluster label, tag heuristic as fallback — not a geo map, ADR 0028/0023/0022); Timeline is a horizontal per-day **date axis** (evenly-spaced `DD/MM/YYYY` columns, files split above/below the axis, drag clamped to the tile's own date column — ADR 0024). Clicking a cloud's label focuses that cloud (others fade; their lines only halfway) and dragging a label moves the whole cloud (Topic; ADR 0024). The connecting lines between tiles (Topic only — Map's geography and Timeline's date axis carry their structure instead) are real relations: files link by shared AI tags (`photo.tags`, from the analyze job) — unanalyzed files have no lines, and the web is deliberately sparse: ambient tags (>24 files) don't link, each file keeps only its 4 strongest same-cloud links, cross-cloud pairs reduce to one strongest bridge per cloud pair, and tiles dropped on an artboard detach (ADR 0022). Timeline/Map/Topic only render inside a project — in all-files mode only `neural` renders and the switcher hides. The label *filter* works everywhere, including all-files, where `SortingActionBar` appears carrying the colour control alone: an untriaged pile is usually what you open all-files to find.
- **Drawer** — the right-side photo detail panel. Its preview carries an **Edit** button (real sources with previews) that opens the **image editor** (`components/editor/ImageEditor.tsx`) — Tier-0 non-destructive crop/rotate/straighten/flip (ADR 0030). The client only builds a `recipe`; the worker renders the edited previews. An edited asset shows "Edited" and offers Revert. The opposite corner carries the **Delete** pill (ADR 0033) — Move to Trash with the same undo toast as the tile/action-bar/right-click deletes; a big selection confirms first, and the homepage Trash view is where photos are restored or purged for good. An unprocessed photo shows one **Analyze & caption** button (analyze chained into caption — see AI actions below); once there are captions the block offers **Generate**/**Regenerate** per lang × style.
Its footer carries **Export** — the drawer's one route into the export dialog, and the
only entry point that starts from a single photo.
- **Facts** — bullets the analyze job extracts, each carrying a `fact_status` (`confirmed` / `likely` / `needs_check`, surfaced as the drawer's three dot colors). **Confirming is an AI action, not bookkeeping:** `apps/worker/src/handlers/caption.ts` prompts with `select text from facts where asset_id = $1 and status = 'confirmed'`, so a confirmed fact is the only user-supplied ground truth that reaches caption generation. Confirmation is per-fact (`PATCH /api/facts/[id]`, RLS `facts_update` = `is_editor_of_asset`); there is deliberately no confirm-all, which would launder unreviewed model output into the next generation's input. Facts carry their DB `id` through `lib/assets.ts` for exactly this; mock rows and the "Analyze to extract facts" placeholder carry `id: null` and get no control.
The same column now has a second consumer, reading it the opposite way: the captions CSV
ships `facts_confirmed` and `facts_unreviewed` as separate columns, so a machine consumer
sees the model's guesses *labelled* rather than filtered. The PDF prints neither — a
document that leaves the building must not assert unreviewed model output in the same
visual register as facts a human verified (ADR 0035 Amendments).
- **AI actions** — every AI entry point (tile ✨ badge, action-bar ✨, left toolbar, right-click menu, drawer) plans its run through the single pure `lib/ai-ops.ts` `planAiRun`, which returns both the jobs to enqueue *and* the button text, so a label can't describe work the run won't do. `ops.tags` → `analyze`, `ops.captions` → `caption`, both → analyze **chained** into caption (the caption prompt reads the facts analyze writes, so they can't be one job; `useWorkspace`'s `followUpCaption` ref fires the second leg when the first reports done). Two operations exist because two job types exist — the panel's old "Detect & group faces" checkbox had neither a job type nor a handler and is gone. Tile badges read `photo.processed` (= `ai_processed_at`, written by analyze only) and clicking one analyzes that photo; `aiBusyIds` marks the tiles inside the running job.

- **Credit** — the usage unit, defined once in `packages/shared/src/usage.ts` and read by both the worker (which writes `usage_events`) and `lib/usage.ts` (which totals them). **1 credit = 1 AI action on 1 photo:** `analyze` costs 1, a caption costs 1 *per language*, and `embedding` / `search_query` / `export` / `asset_ingested` cost **0** — the embedding is the second half of the same analyze call (charging it would double every analysis), and search is the core loop. Storage is a separate axis in bytes, never converted to credits. Limits live in the `plans` table (`beta` / `creator` / `studio`) and are **display-only**: `plans.enforced` is false everywhere and nothing refuses work for lack of credits (ADR 0037, TECH_SPEC §13 "tracking only"). `usage_events.cost_usd` carries a per-unit USD *estimate* for margin reasoning and is never shown to a user.

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

**All of this is real, not aspirational.** `apps/worker` runs all seven job handlers — ingest + analyze + caption + cluster
+ edit + purge + export, one per member of `jobTypeSchema`, so nothing can sit in
the queue without one — plus three retention sweeps on the single 6-hourly tick,
caught independently so a broken one cannot stall its neighbours: trashed
projects, trashed assets, and export artifacts past `EXPORT_RETENTION_DAYS`; `packages/shared` holds live zod contracts both
sides parse; `apps/web` has real auth (`proxy.ts` guard + `lib/supabase/` + the
`lib/safe-redirect.ts` / `lib/auth-errors.ts` guards on the callback), route handlers
under `app/api/`, and RLS-scoped reads via `lib/assets.ts` / `lib/projects.ts`.
Network calls, auth and a database client are **expected** here — an earlier version of
this file forbade them, which was true only before Phase 0.

## Key implementation notes (read before "fixing" something)
- Several behaviors that look like bugs are intentional fidelity to the original design spec, or a deliberate documented deviation from it. See `docs/decisions/` for the list before changing them.
- Layout algorithms are pure, deterministic functions in `lib/layout.ts`: per-project asset grid (`assetGallery`), the circle-packed cloud clusters of Topic (`topicCloudLayout`) via `buildCloudLayout` → `packCircles` (ADR 0022; ADR 0038 added the stale-override check — an override carries the cluster it was dropped in and is ignored once that changes — and moved a cloud's label/backdrop anchor onto its *core*, the members within 2.2 packed radii of the cloud's **median**, so one far-dragged tile stops dragging the name with it while a whole-cloud drag still does), and the Timeline's per-day date axis (`timelineAxisLayout` — no packing, fixed evenly-spaced columns; ADR 0024). Map's clustering moved OUT of `lib/layout.ts` into MapLibre GL + supercluster (ADR 0027) — `mapCloudLayout`/`mapCloudColor`/the `COUNTRY_LATLON` import were deleted. supercluster is deterministic too (no `Math.random`), so the rule below still holds. No `Math.random` on any layout or render path by design — keep it that way for reproducibility. (The one exception is the `crypto.randomUUID` fallback in `lib/upload-client.ts` — an opaque batch key, never a layout input. Don't delete it to "comply": `crypto.randomUUID` is undefined on non-secure-context origins.)
- `components/sidebar/SourceBrowserSidebar.tsx` is mounted by `ArchiveWorkspace` but is **currently unreachable**: `sidebarOpen` derives from `sidebarTabs.length > 0`, and the only function that fills that array (`openSourceTab`) has no callers since #74 removed the canvas source tiles. Its own comments still describe that removed drill-down — don't trust them. Either the entry point comes back or the surface goes; don't assume it works.
