# Architecture

This file describes the **current mockup** — the thing that runs on `main` today.
For the **target backend** (schema, worker, AI pipeline, security), `docs/TECH_SPEC.md`
(v1.2) is the single source of truth and `docs/PLAN.md` is the build order. Don't
duplicate those here.

## What this is (today)
A pnpm + turborepo monorepo. The app in `apps/web` is a frontend-only Next.js
(App Router) + TypeScript port of a Claude Design mockup: an infinite-canvas
photo-archive workspace with four views (Neural graph, Timeline, Map,
Sense/circle-pack), a photo detail drawer, an AI chat panel (canned responses,
no real LLM), and project switching. No backend, no auth, no database — purely a
client-side demo running on mock data. `apps/worker` and `packages/shared` are
Phase-0 scaffolds the backend build fills in.

## Data flow (today — paths relative to `apps/web/`)

```
lib/mock-data.ts            raw mock records + generators
        |
        v
lib/api.ts                  async functions: getPhotos, getPhoto, getProjects,
        |                    getGroups, getSources
        v
app/page.tsx                Server Component; awaits getPhotos() (the others
        |                    exist on the seam but aren't consumed yet)
        v
components/workspace/ArchiveWorkspace.tsx
                             Client Component, owns all interactive state
                             via hooks/useWorkspace.ts
```

`lib/api.ts` is the seam a real backend slots into later: swap the function bodies
from "return the mock array" to "fetch from the real API," and UI code shouldn't
change. Components and hooks are *supposed* to reach data only through `lib/api.ts`,
but a few still import `lib/mock-data.ts` directly (`lib/format.ts`, `lib/layout.ts`,
`hooks/useWorkspace.ts`, `components/map/MapCanvas.tsx`,
`components/toolbar/AddToProjectPopover.tsx`) — known debt, cleaned in PLAN Phase 1.
Don't add new direct imports.

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
