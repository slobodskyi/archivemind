# Architecture

## What this is (today)
A frontend-only Next.js (App Router) + TypeScript port of a Claude Design mockup:
an infinite-canvas photo-archive workspace with four views (Neural graph, Timeline,
Map, Sense/circle-pack), a photo detail drawer, an AI chat panel (canned responses,
no real LLM), and project switching. No backend, no auth, no database — purely a
client-side demo running on mock data.

## Data flow (today)

```
lib/mock-data.ts            raw mock records + generators
        |
        v
lib/api.ts                  async functions: getPhotos, getPhoto, getProjects,
        |                    getGroups, getSources
        v
app/page.tsx                Server Component, awaits the api.ts calls
        |
        v
components/workspace/ArchiveWorkspace.tsx
                             Client Component, owns all interactive state
                             via hooks/useWorkspace.ts
```

Components and hooks never import `lib/mock-data.ts` directly — always through
`lib/api.ts`. This is the seam a real backend slots into later: swap the bodies
of `lib/api.ts`'s functions from "return the mock array" to "fetch from the real
API," and no UI code should need to change.

## Domain glossary
- **Photo** — a single archived image (`types/photo.ts`). Carries EXIF, tags, facts, captions, and a project field.
- **Project** ("archive" in the UI copy) — a named collection a Photo can belong to (frontline / travel / client / all). Selecting a project filters visible photos and switches the view.
- **Group** — a visual/thematic tag (rescue, aid, urban, etc.) used by the Sense view's circle-pack clustering.
- **Source** — where a photo originated (Google Drive / iCloud / Dropbox) — used by the Neural view's hub grouping. Currently cosmetic; no real source integration exists.
- **View** — one of neural / timeline / map / sense; see `components/canvas/`.
- **Drawer** — the right-side photo detail panel.

## Planned (not yet built) — Phase 2
- Backend: Supabase (Postgres + Auth + Storage).
- Large media: Cloudflare R2.
- AI features (real captioning/tagging/chat): Gemini 2.5 Flash-Lite — the UI already brands the (currently fake) chat/bulk-AI panels as "Gemini," so this is the target provider, not an open question.
- Until this lands: don't add real network calls, don't add auth, don't add a database client. Keep everything behind `lib/api.ts` so the swap is contained.

## Key implementation notes (read before "fixing" something)
- Several behaviors that look like bugs are intentional fidelity to the original design spec, or a deliberate documented deviation from it. See `docs/decisions/` for the list before changing them.
- Layout algorithms (Neural hub/folder/file placement, Timeline scatter, Sense circle-pack) are pure, deterministic functions in `lib/layout.ts` — no `Math.random` anywhere in this codebase by design; keep it that way for reproducibility.
