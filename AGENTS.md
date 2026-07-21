<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ArchiveMind

AI-powered creator archive workspace — infinite-canvas photo archive UI.
A **pnpm + turborepo monorepo**, live in production (Phases 0–2 shipped 2026-07-10,
plus Phase 5's homepage + real projects pulled forward, Phases 3–4 (captions,
search) done 2026-07-17/20, and Phase 6's **Google Drive import** done 2026-07-21
(#97–#103 — ADR 0025; Dropbox #24 remains).
`docs/PLAN.md` is canonical for phase status — trust it over this line):
- `apps/web` — Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel:
  real auth (email+password **and Google OAuth** — #89, 2026-07-20), drag-and-drop
  upload to R2, **Google Drive import** (connect → Picker → `POST /api/imports`;
  popup code flow with NO public callback, tokens AES-GCM in `source_connections`,
  worker streams the bytes — ADR 0025, #97–#103), a real homepage of project cards,
  and Canvas/Timeline/Map/Topic all rendering the caller's real assets. **Auth is a hardened surface, not a stub:**
  `/auth/callback` runs the PKCE exchange for both email links and Google, validates
  `?next=` through `lib/safe-redirect.ts` (open redirect, #90), and reports failures
  to `/login` as a *code only* — never the provider's own text. Read
  `docs/decisions/0021` before touching it; the obvious "improvement" of rendering
  `error_description` is the vulnerability that ADR exists to prevent.
  **Trap worth knowing:** Map clusters by `country`, which `lib/assets.ts` still
  fills with the inert `"Ukraine"` default — so on real data Map correctly renders
  exactly one cloud; that's the data, not a bug in the view (ADR 0018). Topic no
  longer shares this trap: `group` is DERIVED from AI tags (`lib/topics.ts`,
  ADR 0023) — real multi-cloud, but only for analyzed assets (unanalyzed →
  Unsorted). The chat panel IS
  Smart Search (#16): `sendChat` calls `GET /api/search` and renders ranked
  results (`lib/chat.ts` keeps only static help/greeting copy).
- `apps/worker` — Railway job worker: ai_jobs queue, ingest (dedup/EXIF/previews,
  HEIC + RAW paths), analyze (Gemini tags/facts + embeddings; user-triggered
  only — never automatic) and caption (styled multilingual captions — live
  end-to-end since #82: drawer Regenerate/edit/Save per lang × style).
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
- `docs/decisions/` — the "why" behind each call. Some ADRs supersede earlier ones in
  part: for the Timeline/Map/Topic views, 0016 → 0017 → 0018 → 0022 → 0023 → 0024 —
  read **0022** (unified cloud canvas + tag-driven connecting lines), **0023**
  (tag-derived Topic clouds) and **0024** (Timeline as a per-day date axis;
  cloud focus/whole-cloud drag) for what ships today.

Work the tracked GitHub issues in phase order; don't jump ahead of the current
phase.

**How data actually reaches the UI** (the "`lib/api.ts` is the only seam" rule in
ADR 0002 no longer describes reality — this does):
- **Server Components** import server-side readers directly and await them:
  `lib/api.ts` (`getPhotos`), `lib/projects.ts` (`getProjectCards`), `lib/bootstrap.ts`.
- **Client components** never touch the database — they go over HTTP to the route
  handlers in `app/api/*`. That's the client seam, and every write goes through it.
- `hooks/useJobProgress.ts` opens its own Supabase Realtime channel.
Add new reads next to the existing readers, and new writes as route handlers.

## Commands (run from the repo root)
- `pnpm dev` — start dev server (localhost:3000)
- `pnpm build` — production build — MUST pass before merging
- `pnpm lint` — ESLint — MUST pass before merging
- `pnpm typecheck` — typecheck (strict mode) — MUST pass before merging
- `pnpm test` — Vitest unit/contract tests — MUST pass before merging

All five dispatch through turborepo to every workspace package that defines the
script (packages without it are skipped). CI runs them as one job named `checks`:
`pnpm turbo run lint typecheck test build` — a red test blocks merge exactly like
a type error.

The pgTAP suites (`supabase/tests/*.sql`) run in CI as the required `db-tests`
check (fast-skips on non-DB PRs; full run when `supabase/**` changes — ADR 0020,
required since 2026-07-17). `supabase test db` locally is the fast pre-flight
when you touch `supabase/**`, not the only line of defence anymore.

## Conventions
- TypeScript strict, no `any`.
- Mockup paths below are relative to **`apps/web/`**.
- Mock/demo data lives in `lib/mock-data.ts` (`lib/chat.ts` is now only static
  help/greeting copy — the canned replies retired with #84). **Known debt:**
  three modules still import `lib/mock-data.ts`
  directly — `lib/format.ts` (STATUS_META), `lib/layout.ts`
  (COUNTRY_LATLON/GROUPS/SOURCES), `components/sidebar/SourceBrowserSidebar.tsx`
  (SOURCES). They're cleaned as their features go real; untracked, no issue yet.
  Don't add new direct imports. (`lib/api.ts` imports it too — that's the seam
  doing its job, not debt.)
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
- **Secrets are live — this repo is past the "no backend" stage.** `apps/web/.env.local`
  (untracked) holds real Supabase + R2 credentials; the worker's Railway env holds
  `DATABASE_URL`, R2 keys, and `GEMINI_API_KEY`. Never commit `.env` files or API keys —
  `.gitignore` excludes `.env*` and only `apps/web/.env.example` is tracked; keep it that
  way. `.worktreeinclude` copies `.env.local` into new worktrees, so treat those as
  secret-bearing too. Never paste env values into issues, PRs, or logs.
- Migrations are developed against local Supabase (`supabase db reset` replays them) and
  land on the single EU cloud project, which doubles as shared testing until the first
  external users — so a bad migration hits real infrastructure. **Oleksandr (`slobodskyi`)
  is the migrations owner:** schema changes land PR-only, through him, never ad hoc —
  see @CONTRIBUTING.md.

## See also
- `docs/TECH_SPEC.md` — **canonical** design/architecture/schema (v1.2)
- `docs/PLAN.md` — the Phase 0–7 build order
- @ARCHITECTURE.md — the *current mockup's* data flow + domain glossary
- @CONTRIBUTING.md — git workflow, PR process, review checklist
- `docs/decisions/` — architecture decision records; read before assuming "why"
