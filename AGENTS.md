<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ArchiveMind

AI-powered creator archive workspace — infinite-canvas photo archive UI.
A **pnpm + turborepo monorepo** (backend build Phase 0 in progress):
- `apps/web` — the Next.js (App Router) + TypeScript + Tailwind mockup, ported
  pixel-for-pixel from a Claude Design `.dc.html` prototype; all data is mock data
  behind a thin API layer (see below).
- `apps/worker` — Railway job worker (scaffold only; skeleton lands in Phase 1).
- `packages/shared` — zod schemas / domain contracts shared by web + worker.

Target stack: Supabase (Postgres + Auth + pgvector),
Cloudflare R2 (all binaries), and a **worker on Railway** for heavy jobs
(ingest/analyze/caption/export). AI = `gemini-3.1-flash-lite` via the
`GEMINI_ANALYZE_MODEL` env var for captions/analysis/search + `gemini-embedding-2`
for embeddings (never hardcode a model generation — see `docs/decisions/0010`).

**Before writing any backend code, read the canonical docs — do not infer the
design from this file:**
- `docs/TECH_SPEC.md` (v1.2) — canonical for the domain model (**Asset ≠ File**),
  architecture, schema, models, and security. Single source of truth.
- `docs/PLAN.md` — the phase-by-phase build order (Phase 0–7).
- `docs/decisions/` — the "why" behind each call (ADRs 0001–0011).

Work the tracked GitHub issues in phase order; don't jump ahead of the current
phase. Until a phase touches it, keep new work behind `lib/api.ts` (below).

## Commands (run from the repo root)
- `pnpm dev` — start dev server (localhost:3000)
- `pnpm build` — production build — MUST pass before merging
- `pnpm lint` — ESLint — MUST pass before merging
- `pnpm typecheck` — typecheck (strict mode) — MUST pass before merging

All four fan out through turborepo to every workspace package.

## Conventions
- TypeScript strict, no `any`.
- Mockup paths below are relative to **`apps/web/`**.
- Mock/demo data lives in `lib/mock-data.ts` (plus the canned chat/search surface
  in `lib/chat.ts`). Components and hooks should reach data only through
  `lib/api.ts` (async functions) — that's the seam a real backend swaps into
  without touching UI. **Known debt:** a few modules still import `lib/mock-data.ts`
  directly (`lib/format.ts`, `lib/layout.ts`, `hooks/useWorkspace.ts`,
  `components/map/MapCanvas.tsx`, `components/toolbar/AddToProjectPopover.tsx`);
  PLAN Phase 1 cleans these as features go live — don't add new direct imports.
- Shared domain types for the mockup live in `apps/web/types/`; reuse them, don't
  redefine inline shapes. Cross-package contracts (web ↔ worker) live in
  `packages/shared` as zod schemas.
- Styling: ported elements intentionally use inline `style={{}}` objects, not
  Tailwind utility classes, to guarantee pixel fidelity to the source design — see
  `docs/decisions/0001-inline-styles-over-tailwind.md`. Tailwind is fine for new,
  non-computed structural styling.
- Several behaviors that look like bugs are intentional fidelity to the source
  design (or a deliberate, documented deviation from it) — see
  `docs/decisions/0003-preserve-source-quirks.md` and
  `docs/decisions/0005-functional-project-filtering.md` before "fixing" one.

## Repository etiquette
- Trunk-based: branch from `main`, short-lived branches, squash-merge, delete
  branch after merge. Branch naming: `feat/`, `fix/`, `docs/`, `chore/` + short name.
- Rebase your own branch onto `main` before opening a PR. Never rebase a branch the
  other person has already pulled.
- Conventional commits (feat/fix/chore/docs).
- Full workflow: @CONTRIBUTING.md

## Risk zones
- No secrets exist in this repo yet (no backend). Once backend work starts: never
  commit `.env` files or API keys; a single assigned migrations owner runs schema
  changes, PR-only — see @CONTRIBUTING.md.

## See also
- `docs/TECH_SPEC.md` — **canonical** design/architecture/schema (v1.2)
- `docs/PLAN.md` — the Phase 0–7 build order
- @ARCHITECTURE.md — the *current mockup's* data flow + domain glossary
- @CONTRIBUTING.md — git workflow, PR process, review checklist
- `docs/decisions/` — architecture decision records; read before assuming "why"
