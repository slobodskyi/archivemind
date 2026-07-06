# 0002. All data access goes through lib/api.ts, never lib/mock-data.ts directly

Date: 2026-07-02

Status: Accepted

**Superseded in part by 0011** — the *target* seam is `getAssets`/`getAsset`. The
mockup still ships `getPhotos`/`getPhoto`; the rename lands during the build
(PLAN Phase 1).

## Context

We're in a mockup phase now (no backend); the real backend (Supabase) is planned
next — see `docs/PLAN.md` (Phase 0–7). We want that migration to touch as little UI
code as possible.

## Decision

All mock/demo data (photos, captions, tags, EXIF, projects, groups, sources) lives
in `lib/mock-data.ts`. Components and hooks never import it directly — they only
ever call the async functions in `lib/api.ts` (`getPhotos`, `getPhoto`,
`getProjects`, `getGroups`, `getSources`). Those functions are async today even
though they resolve synchronously, specifically so a real fetch-based
implementation is a drop-in swap later, and so Server Components can await them
now.

## Consequences

A little ceremony now (async wrappers around what's currently a synchronous
in-memory read) pays for itself when the backend lands — the swap is contained to
`lib/api.ts`'s function bodies, with zero UI changes required. No exceptions to
this rule going forward, including for new mock data added later.

**Known debt (as of the mockup):** five modules predating this rule still import
`lib/mock-data.ts` directly (`lib/format.ts`, `lib/layout.ts`,
`hooks/useWorkspace.ts`, `components/map/MapCanvas.tsx`,
`components/toolbar/AddToProjectPopover.tsx`). PLAN Phase 1 cleans them as those
features go real; don't add new direct imports in the meantime.
