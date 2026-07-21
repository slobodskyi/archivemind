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

> **Superseded in practice by the real topology — see ARCHITECTURE.md.** `lib/api.ts`
> is no longer the single UI→data seam: Server Components await `lib/api.ts`
> (`getPhotos`), `lib/projects.ts` and `lib/bootstrap.ts` directly, while client
> components never touch the database and go over HTTP to the route handlers in
> `app/api/*` — that is the client seam, and every write lives there (the cloud-import
> work added `app/api/imports` and `app/api/integrations/google[/connect]`).
> `getPhoto`/`getProjects`/`getGroups`/`getSources` survive as dead mocks with zero
> callers. The rule below still holds in spirit: **no component reads mock data or the
> database directly.**

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

**Known debt (verified 2026-07-21):** three modules still import `lib/mock-data.ts`
directly — `lib/format.ts` (STATUS_META), `lib/layout.ts`
(GROUPS/SOURCES) and `components/sidebar/SourceBrowserSidebar.tsx`
(SOURCES). (`lib/api.ts` imports it too — that is the seam doing its job, not debt.)
`hooks/useWorkspace.ts` and `components/toolbar/AddToProjectPopover.tsx` are clean
now, and `components/map/` no longer exists (ADR 0016→0022). They're cleaned as
their features go real; don't add new direct imports in the meantime.
