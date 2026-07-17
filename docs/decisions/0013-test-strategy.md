# 0013 — Test strategy: contract + worker-unit + RLS suites; no E2E in MVP

Status: accepted (2026-07-10) · Issue: #31
Amended 2026-07-14: the deferred CI wiring for layer 3 landed — see ADR 0020.

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
   migrations owner, and (since 2026-07-14, ADR 0020) enforced by the `db-tests`
   CI job, which boots Postgres and runs the suite whenever a PR touches
   `supabase/**`.
4. **API route contract tests** (from Phase 1): route handlers validated
   against shared schemas with a mocked db client.

**Explicitly out (MVP):** component/E2E tests (Playwright smoke for
signup → upload → drawer becomes a fast-follow around Phase 2), coverage
thresholds, visual regression (design fidelity is protected by ADR 0001/0003
conventions, not pixels).

## Consequences

- CI stays one job, a few seconds slower; a failing schema/RLS test blocks
  merge exactly like a type error. (Amended: CI is now two jobs — ADR 0020 adds
  `db-tests` alongside `checks`, since the pgTAP suite needs Docker and only
  earns its cost on `supabase/**` changes.)
- RLS regressions become executable: the Phase-0 bootstrap bug (workspace
  `INSERT … RETURNING` vs creator visibility, fixed in migration 0002) is now
  a permanent test case.
- Adding a schema without tests is visible in review (contract-test pattern
  lives next to the schema file).
- `supabase test db` requires the local stack. DB-test CI automation was
  deferred here and never picked up — PR #74 then shipped migration
  `20260713000001` through green CI with no coverage of its own columns. ADR
  0020 closes that hole; the gap it left open is the reason that ADR exists.
