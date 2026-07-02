<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ArchiveMind

AI-powered creator archive workspace — infinite-canvas photo archive UI.
Currently a **frontend-only mockup**: Next.js (App Router) + TypeScript + Tailwind,
ported pixel-for-pixel from a Claude Design `.dc.html` prototype. All data is mock
data behind a thin API layer (see below). No backend exists yet.

Planned, not yet built: Supabase (Postgres + Auth + Storage), Cloudflare R2 for
large media, Gemini 2.5 Flash-Lite for AI features (captions/tags/chat — the UI
already brands the currently-fake chat/bulk-AI panels as "Gemini," so that's the
target provider, not an open question). Don't write code against any of this until
the migration actually starts — see @ARCHITECTURE.md.

## Commands
- `npm run dev` — start dev server (localhost:3000)
- `npm run build` — production build — MUST pass before merging
- `npm run lint` — ESLint — MUST pass before merging
- `npx tsc --noEmit` — typecheck (strict mode) — MUST pass before merging

## Conventions
- TypeScript strict, no `any`.
- ALL mock/demo data lives in `lib/mock-data.ts`; components and hooks only ever
  call `lib/api.ts` (async functions). Never import `mock-data.ts` directly from a
  component — this is the seam a real backend swaps into later without touching UI.
- Shared domain types live in `types/`; reuse them, don't redefine inline shapes.
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
  commit `.env` files or API keys; only one person runs database migrations at a
  time — see @CONTRIBUTING.md.

## See also
- @ARCHITECTURE.md — system overview, current vs. planned stack, domain glossary
- @CONTRIBUTING.md — git workflow, PR process, review checklist
- `docs/decisions/` — architecture decision records; read before assuming "why"
