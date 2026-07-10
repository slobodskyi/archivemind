# Architecture

This file describes the **current mockup** — the thing that runs on `main` today.
For the **target backend** (schema, worker, AI pipeline, security), `docs/TECH_SPEC.md`
(v1.2) is the single source of truth and `docs/PLAN.md` is the build order. Don't
duplicate those here.

## What this is (today)
A pnpm + turborepo monorepo, live in production (Phases 0–1 shipped, Phase 2 in
progress). `apps/web` (Vercel) is the ported Claude Design canvas UI with real
email+password auth, drag-and-drop upload to R2, and a canvas that renders the
caller's own assets. `apps/worker` (Railway) processes `ai_jobs`: ingest
(sha256 dedup / EXIF / webp previews, incl. HEIC + RAW-embedded-JPEG paths) and
analyze (Gemini tags/facts + 768-dim image embeddings — user-triggered only).
`packages/shared` holds the zod contracts both sides parse. Map/Sense views,
projects, chat/search and a few drawer surfaces still run on mock data until
their phases.

## Data flow (today — paths relative to `apps/web/`)

```
Supabase Postgres (RLS)  ⇄  apps/worker (Railway): ai_jobs queue —
        |                    ingest → previews/EXIF → R2 · analyze → tags/embeddings
        v
lib/assets.ts               RLS-scoped select + presigned R2 preview URLs,
        |                    mapped into the mockup's Photo shape
        v
lib/api.ts                  getPhotos()/getPhoto() = REAL · getProjects/
        |                    getGroups/getSources = still mock (their phases)
        v
app/page.tsx                Server Component; guards auth, bootstraps the
        |                    workspace, awaits getPhotos()
        v
components/workspace/ArchiveWorkspace.tsx  (+ components/upload/UploadManager:
                             window drag-drop → presign → R2 → complete → ingest job)
```

`lib/api.ts` remains the only UI→data seam. Real assets carry `src/srcMedium`
(presigned previews, `lib/img.ts` falls back to a neutral tile while previews
are pending — picsum only ever renders for mock rows). Some modules still
import `lib/mock-data.ts` lookup tables directly (`lib/format.ts`,
`lib/layout.ts`, `hooks/useWorkspace.ts`, `components/map/MapCanvas.tsx`,
`components/toolbar/AddToProjectPopover.tsx`) — known debt, cleaned as their
features go real. Don't add new direct imports.

## Domain glossary (mockup terms)
These are the mockup's shapes. The **target** model differs — see the note below.

- **Photo** — a single archived image (`types/photo.ts`). Carries EXIF, tags, facts, captions, and a project field.
- **Project** ("archive" in the UI copy) — a named collection a Photo can belong to (frontline / travel / client / all). Selecting a project filters visible photos and switches the view.
- **Group** — a visual/thematic tag (rescue, aid, urban, etc.) used by the Sense view's circle-pack clustering.
- **Source** — where a photo originated (Google Drive / iCloud / Dropbox) — used by the Neural view's hub grouping. Currently cosmetic; no real source integration exists.
- **View** — one of neural / timeline / sense (`components/canvas/`) or map (`components/map/`).
- **Drawer** — the right-side photo detail panel.

> **Target model (TECH_SPEC v1.2 / ADR 0011):** the mockup's flat `Photo` becomes
> **Asset ≠ File** — an `asset` is the canonical entity (one shot/document) and
> `files` are its physical representations; EXIF/tags/captions/facts/embeddings and
> project membership all reference `asset_id`, and projects are **M:N** (a file can
> live in many projects), not the mockup's single project field. Sources become real
> Google Drive / Dropbox integrations (no iCloud in MVP). The rename lands during the
> build phases — see the spec, don't reshape the mockup ahead of it.

## Target stack (Phase 0 in progress)
See `docs/TECH_SPEC.md` §2–§3. In brief: monorepo `apps/web` (Vercel) +
`apps/worker` (Railway) + `packages/shared` + `supabase/`; Supabase Postgres
(+ Auth, pgvector, Realtime); Cloudflare R2 for all binaries; Gemini
(`gemini-3.1-flash-lite` + `gemini-embedding-2`) for AI. The monorepo shell exists;
the worker and shared contracts are still scaffolds. Until a build phase touches
it, don't add real network calls, auth, or a database client to the mockup — keep
everything behind `lib/api.ts` so the swap stays contained.

## Key implementation notes (read before "fixing" something)
- Several behaviors that look like bugs are intentional fidelity to the original design spec, or a deliberate documented deviation from it. See `docs/decisions/` for the list before changing them.
- Layout algorithms (Neural hub/folder/file placement, Timeline scatter, Sense circle-pack) are pure, deterministic functions in `lib/layout.ts` — no `Math.random` anywhere in this codebase by design; keep it that way for reproducibility.
