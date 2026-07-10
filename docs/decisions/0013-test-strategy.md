# 0013 — Test strategy: contract + worker-unit + RLS suites; no E2E in MVP

Status: accepted (2026-07-10) · Issue: #31

## Context

CI ran lint + typecheck + build only. The backend build adds three classes of
risk that static checks can't catch: wire-format drift between web and worker,
silent breakage in worker pipeline logic, and RLS leaks between workspaces —
the one bug class we cannot afford to ship. Two devs working through AI agents
need tests agents can run cheaply on every change; heavyweight E2E would slow
every iteration while the UI is still moving.

## Decision

**Runner: Vitest**, per-package `test` scripts, `turbo run test` inside the
existing CI `checks` job (job name unchanged — the branch-protection ruleset
keys on it). Packages without a `test` script are skipped, so empty packages
cost nothing.

Layers, in value order:
1. **Contract tests** (`packages/shared`, colocated `*.test.ts`): every zod
   schema gets parse + reject cases. Pins the web ↔ worker wire format.
2. **Worker unit tests** (from Phase 1): pure logic — retry/backoff math,
   reaper cutoffs, handlers with `services/*` mocked as interfaces. No API
   keys in tests.
3. **RLS suites** (`supabase/tests/*.sql`, pgTAP via `supabase test db`):
   workspace isolation, asset-child isolation, write denial, bootstrap path,
   token-column revoke. **Gate for every migration PR** — run locally by the
   migrations owner; CI wiring on `supabase/**` changes is a follow-up
   (needs the CLI + Docker in Actions).
4. **API route contract tests** (from Phase 1): route handlers validated
   against shared schemas with a mocked db client.

**Explicitly out (MVP):** component/E2E tests (Playwright smoke for
signup → upload → drawer becomes a fast-follow around Phase 2), coverage
thresholds, visual regression (design fidelity is protected by ADR 0001/0003
conventions, not pixels).

## Consequences

- CI stays one job, a few seconds slower; a failing schema/RLS test blocks
  merge exactly like a type error.
- RLS regressions become executable: the Phase-0 bootstrap bug (workspace
  `INSERT … RETURNING` vs creator visibility, fixed in migration 0002) is now
  a permanent test case.
- Adding a schema without tests is visible in review (contract-test pattern
  lives next to the schema file).
- `supabase test db` requires the local stack; DB-test CI automation is
  deferred and tracked in #31 until it lands.
