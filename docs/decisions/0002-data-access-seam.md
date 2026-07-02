# 0002. All data access goes through lib/api.ts, never lib/mock-data.ts directly

Date: 2026-07-02

Status: Accepted

## Context

We're in a mockup phase now (no backend) but a real backend (Supabase) is planned
for Phase 2. We want that migration to touch as little UI code as possible.

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
