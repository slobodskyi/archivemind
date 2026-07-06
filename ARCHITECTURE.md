# Architecture

## What this is (today)
A frontend-only Next.js (App Router) + TypeScript port of a Claude Design mockup
(v2 redesign — see `docs/decisions/0006-redesign-v2-full-replace.md`): an
infinite-canvas photo-archive workspace for a single archive with four views
(Canvas free-form, Timeline, Map, Smart/grouped), a photo detail drawer, and a
bulk-AI operations panel (canned responses, no real LLM). No backend, no auth,
no database — purely a client-side demo running on mock data.

## Data flow (today)

```
lib/mock-data.ts            raw mock records + generators
        |
        v
lib/api.ts                  async functions: getPhotos, getPhoto, getGroups
        |
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
- **Photo** — a single archived image (`types/photo.ts`). Carries EXIF, tags, facts, captions, and a group.
- **Group** — a visual/thematic tag (rescue / aid / urban / street) used by the Smart view's fixed-hub clustering.
- **Bookmark** — UI-only per-photo toggle state (`Set<string>` of ids in `useWorkspace.ts`), not a `Photo` field.
- **View** — one of `canvas` (free-form, default) / `timeline` / `map` / `smart`; see `components/canvas/CanvasContent.tsx`, which renders all four as one consolidated component (per-view decoration + a single shared photo-tile loop), matching the source mockup's own structure.
- **Drawer** — the right-side photo detail panel.

There is a single hardcoded archive ("Kyiv 2026 — Frontline") — no multi-project
switching and no source-integration concept (Google Drive/iCloud/Dropbox appear
only as labels in the Import dropdown, not as photo metadata).

## Planned (not yet built) — Phase 2
- Backend: Supabase (Postgres + Auth + Storage).
- Large media: Cloudflare R2.
- AI features (real captioning/tagging): Gemini 2.5 Flash-Lite — the UI already brands the (currently fake) bulk-AI panel as "Gemini," so this is the target provider, not an open question.
- Until this lands: don't add real network calls, don't add auth, don't add a database client. Keep everything behind `lib/api.ts` so the swap is contained.

## Key implementation notes (read before "fixing" something)
- Several behaviors that look like bugs are intentional fidelity to the original design spec, or a deliberate documented deviation from it. See `docs/decisions/` for the list before changing them.
- Layout logic (Timeline time-sort + lane-packing, Map's fixed country coordinates + inline SVG polygons, Smart's fixed hub coordinates) lives in `lib/layout.ts`'s `computeLayout()` — no `Math.random` anywhere in this codebase by design; keep it that way for reproducibility. There's no hash-based placement in v2 at all (removed as dead code — see 0006).
