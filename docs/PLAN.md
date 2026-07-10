# ArchiveMind MVP — Build Plan

Date: 2026-07-06 · Source spec: [TECH_SPEC.md](./TECH_SPEC.md) **v1.2**
Team: 2 devs (AI-assisted), trunk-based, squash-merge (see CONTRIBUTING.md).

This plan turns TECH_SPEC.md §15 into an executable order of work. The spec is
canonical for the domain model, architecture, models / libraries / config; this
plan is the sequencing. Decision records for the key calls live in `docs/decisions/`.

---

## 0. Spec amendments — folded into the spec

The 2026-07-03 pre-build verification amendments (originally `PLAN.md` §0) and the v1.2 Asset ≠ File revision are now folded directly into **[TECH_SPEC.md](./TECH_SPEC.md) v1.2** (§2–§14). This plan is the execution order only; where it names models / libraries / schema / spikes, the spec is canonical. (Section references below point at TECH_SPEC v1.2; the old "A#" amendment ids are retired.)

---

## 1. Current state → target

**Have:** polished frontend mockup (Next 16.2.10, React 19, Tailwind v4, npm, single app at repo root). Data seam `lib/api.ts` in place (5 fns; only `getPhotos` consumed today). 235 mock photos, deterministic layouts, no undo/redo yet (journey asks for it — new work, Phase 5). Known seam leaks to fix during integration: `lib/format.ts`, `lib/layout.ts`, `hooks/useWorkspace.ts`, `components/map/MapCanvas.tsx`, `components/toolbar/AddToProjectPopover.tsx` import `mock-data` lookup tables directly; `lib/chat.ts` is the canned-LLM surface search replaces.

**Target:** monorepo `apps/web` (Vercel) + `apps/worker` (Railway) + `packages/shared` + `supabase/`, per spec §2–§3 (TECH_SPEC v1.2).

---

## 2. Build order

Two lanes after Phase 0: **Lane W (web)** and **Lane K (worker/pipeline)** — one dev each, swap as needed. **Migrations owner: assign ONE dev in Phase 0** (spec §3); schema changes PR-only.

### Phase 0 — Foundations (both devs, ~week 1)

**0.1 Monorepo restructure** (one PR, one dev, no functional changes). Checklist from repo analysis:
- pnpm workspace + turborepo; root `package.json` (`packageManager` pin, engines), `pnpm-workspace.yaml`, `turbo.json`; delete `package-lock.json`.
- Move app → `apps/web` (app/, components/, hooks/, lib/, types/, configs). `@/*` tsconfig alias survives as-is (70 imports, zero parent-relative).
- `next.config.ts`: set `turbopack.root` (top-level key in Next 16) + `outputFileTracingRoot` to repo root (multiple-lockfile inference).
- `.gitignore`: un-anchor root-anchored patterns (`/node_modules`, `/.next/`, `/out/`, `/build`, `/AI-powered creator archive tool/`); add `.turbo/`.
- ESLint flat config moves as-is — it's already the Next-16 style (`defineConfig` + subpath exports); do NOT "normalize" to FlatCompat.
- CI: npm → pnpm/turbo (`pnpm/action-setup`, `pnpm install --frozen-lockfile`, `turbo run lint typecheck build`).
- Vercel: repoint Root Directory to `apps/web`, install cmd pnpm. `.claude/settings.json` + `launch.json` + AGENTS.md/CONTRIBUTING.md command docs → pnpm.
- Scaffold `packages/shared` (zod + domain types seeded from `types/` inventory) and empty `apps/worker`.
- Next-16 notes for all future work: `proxy.ts` (NOT `middleware.ts`); async-only `cookies()/headers()/params`.

**0.2 Accounts & infra** (other dev, parallel): Supabase project (EU region) + enable pgvector; Cloudflare R2 bucket + CORS (incl. `ExposeHeaders: ETag`); Railway project; Google Cloud project (OAuth client, Picker API key — note project *number* for `setAppId`); Dropbox app key + Chooser domain registration; Gemini **service-account AUTH key** (not a standard API key) with billing enabled (Tier 1+) — see spec §11; Vercel + Railway env vars per spec §11 (with `GEMINI_ANALYZE_MODEL` added); **Resend** account + verified sending domain, plugged into Supabase Auth as custom SMTP (the built-in mailer is dev-only, ~2 emails/h) — carries signup/reset emails now, invites/billing later; **Sentry** org with two projects (`archivemind-web`, `archivemind-worker`) → DSN env vars. Click-through checklist: issue #4 comment (2026-07-10).

**Environments (decided, issue #32):** dev = **local Supabase** (CLI + Docker; `supabase db reset` replays migrations), prod = the one EU cloud project, which doubles as shared testing until first external users (no real user data during the build); add a true staging project at Phase 7's security pass. R2: `-dev` and `-prod` buckets.

**0.3 Migration 0001 + RLS + auth**: full spec §4 schema (Broadcast trigger on `ai_jobs` per §5; `source_connections` effectively Drive-only per ADR 0008). RLS helpers `is_member/is_owner/is_editor` + policies on every table. Supabase Auth — **email+password at launch; Google login is a fast-follow toggle** (same Google Cloud OAuth client as the Picker, provisioned in 0.2) — with auth emails through Resend SMTP; `apps/web` auth screens + `proxy.ts` guard + first-login bootstrap (profile → workspace → owner membership, in app code). Wire `@sentry/nextjs` here, env-gated (no DSN = disabled locally).

**✅ Deploy checkpoint 1:** deployed web app on Vercel, sign-up → empty authed workspace, schema live, CI green.

### Phase 1 — Upload → ingest end-to-end (~weeks 2–3)

- **Lane W:** upload UI (drag-drop + file picker) → `POST /api/uploads/presign` (single PUT <100 MiB; fixed-size multipart above) → `POST /api/uploads/complete` (creates asset + file); assets list via `GET /api/assets` replacing `getPhotos()`→`getAssets()` in `lib/api.ts`; `useJobProgress` hook on the Broadcast channel.
- **Lane K:** worker skeleton on Railway (`node:22-slim`, session-pooler pg Pool max 2–5): claim loop (`FOR UPDATE SKIP LOCKED`), heartbeat, retry/backoff, reaper, graceful shutdown (spec §7 verbatim); `@sentry/node` capture around job execution. Ingest handler: sha256 dedup → EXIF (`exifr` / `exiftool-vendored` v36) → previews via sharp (+ `heic-decode` path, RAW cascade per §8.1) → R2 previews → `asset_exif`/`asset_previews` rows (dedup attaches file to existing asset) → auto-enqueue `analyze`.
- QA with dirty samples: HEIC from real iPhones, NEF/CR2/ARW, no-EXIF files (closes §14 items 1–2: HEIC throughput, RAW coverage).

**✅ Deploy checkpoint 2:** upload 500+ real mixed files → previews & EXIF appear in the deployed UI with live progress.

### Phase 2 — Analyze pipeline (~week 4)

- **Lane K:** analyze handler: medium preview → `gemini-3.1-flash-lite` via `generateContent` + `responseSchema` structured output (zod schema from `packages/shared`) → tags/facts upserts; embeddings via `gemini-embedding-2` (one `Content` per image, 768 dims) → `embeddings`; `usage_events` on every call; concurrency cap 5 + 429 backoff.
- **Lane W:** drawer shows real tags/captions/facts/EXIF (`GET /api/assets/:id`); bulk-AI panel → real `POST /api/jobs` + Realtime progress (replaces fake `setInterval`); manual tag add/remove; fact confirm (`PATCH /api/facts/:id`).

### Phase 3 — Captions (~week 5, can overlap Phase 4)

Caption handler (langs × styles, prompt templates in `packages/shared/prompts.ts` + per-project `caption_prompt`); `PATCH /api/captions/:id` editing (`is_edited`), regenerate-confirm flow; drawer language/style switching backed by real rows.

### Phase 4 — Search (~week 5–6)

`GET /api/search`: `gemini-3.1-flash-lite` query parse (structured output via `generateContent`) → embed query text into the same space → pgvector cosine (HNSW) scoped to workspace/project + metadata joins (dates from `asset_exif.taken_at`, places via `gps_label`/place-tags with the no-GPS fallback, tag boost) → top-N with matched-filter explanation. Wire into the chat panel (canned replies → search results; `lib/chat.ts` retires). Log `search_query` usage.

### Phase 5 — Projects + canvas at scale (~weeks 6–7)

- Projects CRUD + M:N (`POST /api/projects`, `.../assets` — membership is asset-based per §4/ADR 0011), add-to-project from selection/search (replaces in-memory `addToProject`).
- `GET /api/canvas` aggregates (sources → folders → counts + first-K previews); Neural view consumes aggregates, materializes tiles only for expanded folders/viewport, caps ~300 mounted tiles, virtualizes (mockup renders 235; real archives 10k–30k — this is the riskiest frontend task, spike early with 20k synthetic rows).
- `PUT /api/canvas/layout` persistence of `overrides` (hub/folder/asset levels per §4) / organize mode; organize modes `source|date|place` (similarity post-MVP per spec §13). Client-side **undo/redo** for drags (journey requirement; doesn't exist in the mockup — new work).
- **Views:** Timeline + Neural are MVP gates. **Map + Sense are fast-follow** (built on live data, but not gating a milestone — Map depends on GPS and Sense on rich tags, both of which real pro archives often lack). This matches the `fast-follow` label on those issues.
- Replace mock quirks with real data: timeline bucketing `hash(id)%6` → real `taken_at`; per-asset EXIF; per-asset titles.

### Phase 6 — Cloud imports (~week 7)

- **Drive:** OAuth (`drive.file`) + token encryption (`TOKEN_ENC_KEY`, AES-GCM) → Picker per §9 (multi-file, MIME-filtered, LIST mode, `setAppId`) → `POST /api/imports` → ingest (worker streams `files.get?alt=media`).
- **Dropbox:** Chooser (direct links, no OAuth — ADR 0008) → `POST /api/imports` → worker streams bytes within the 4 h window; originals → R2 (ADR 0008); 429/`Retry-After` handling; stale-link (410) re-request guard.

**✅ Deploy checkpoint 3:** full journey — connect Drive, pick 200 files, they ingest, analyze, and are searchable.

### Phase 7 — Export + hardening (~week 8)

Export handler (ZIP: owned originals else medium previews + note; `captions.csv` sidecar) → R2 `exports/` + presigned GET (7 d = R2 max). Deletion flows (soft-delete + R2 purge; `source_missing` on fetch failure keeps derivatives). Security pass per spec §12 (RLS audit, token handling, TTLs). Privacy Policy + ToS before first external user. Full QA on a real dirty archive.

---

## 3. Working agreements for this build

- Each phase = short-lived branches into `main`; deploy checkpoints must be green before the next phase starts (spec §15 discipline).
- `lib/api.ts` stays the only UI→data seam; Phase 1 also cleans the 5 known mock-data leak sites as their features go real.
- Every AI call writes a `usage_events` row from day 1 — no exceptions (future credits model).
- Decision records for the key backend calls (accepted; expand as phases start): [0007 generateContent-over-Interactions](decisions/0007-generatecontent-over-interactions.md), [0008 dropbox-originals-in-r2](decisions/0008-dropbox-originals-in-r2.md) (Phase 6), [0009 broadcast-over-postgres-changes](decisions/0009-broadcast-over-postgres-changes.md) (Phase 0), [0010 analyze-model-choice](decisions/0010-analyze-model-choice.md) (Phase 2), [0011 asset-over-file](decisions/0011-asset-over-file.md) (the v1.2 domain model).
- Re-verify model ids/prices when Phase 2 starts — Gemini's surface moves fast (model sunsets, shifting API shapes). We pin `generateContent` + `gemini-3.1-flash-lite` (ADR 0007 / 0010) and evaluate `gemini-3.5-flash` at Phase 2.

---

## 4. Open items to schedule (not yet ticketed)

Gaps surfaced in the 2026-07-06 setup audit. Fold each into a GitHub issue (via
`scripts/setup-issues.sh`) when its phase starts:

- **Test strategy + CI wiring (decided 2026-07-10, issue #31).** Vitest workspace-wide;
  layers in value order: `packages/shared` zod contract tests → worker pure-logic
  unit tests (mocked services) → RLS policy suites via `supabase test db` (gate for
  migration PRs) → API route contract tests from Phase 1. `turbo run test` joins the
  CI `checks` job. No E2E/coverage gates in MVP (Playwright smoke ≈ Phase 2
  fast-follow). ADR lands with the wiring PR.
- **Source real sample corpora (Phase 1).** M2, and the Phase-1/Phase-7 QA issues,
  all gate on real dirty files (500+ mixed, real-iPhone HEIC, NEF/CR2/ARW, no-EXIF).
  Someone must actually gather these from target users — an unowned dependency that
  can block a milestone.
- **Seam-leak cleanup as a tracked task (Phase 1).** The five direct `mock-data`
  importers (see §1) are covered in prose but map to no issue.
- **Phase-2 analyze-model re-verify (Phase 2).** Spec §14 item 3 / §3 above — confirm
  `gemini-3.1-flash-lite` id+price and the `generateContent` shape, evaluate
  `gemini-3.5-flash`. Currently in no issue (issue #9 covers only HEIC/RAW QA).
- **dev vs prod environments (decided 2026-07-10, issue #32).** Local Supabase for
  dev; one EU cloud project as prod (doubles as shared testing until first external
  users); staging added at Phase 7. Provisioning itself stays issue #4.
