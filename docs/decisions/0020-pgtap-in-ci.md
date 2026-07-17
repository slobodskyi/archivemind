# 0020. Run the pgTAP suite in CI, filtered inside the job, not on the trigger

Date: 2026-07-14

Status: Accepted

## Context

ADR 0013 made the pgTAP suite (`supabase/tests/*.sql`) the "Gate for every
migration PR", then deferred the half that makes a gate a gate: "run locally by
the migrations owner; CI wiring on `supabase/**` changes is a follow-up (needs
the CLI + Docker in Actions)." The follow-up never happened, so the gate was a
convention — it held exactly as long as whoever opened the migration PR
remembered it.

It didn't hold. On 2026-07-14 we found that PR #74 added migration
`20260713000001` (`projects.archived_at` / `deleted_at`) and merged through
green CI with zero pgTAP coverage of its own columns. CI `checks` runs
`turbo run lint typecheck test build` and never touches a database, so a green
tick on a migration PR asserted nothing whatsoever about the schema. That same
migration later turned out to be the fix for a live 500 on
`PATCH /api/projects/[id]` — the class of bug this suite exists to catch.

The wiring itself is unremarkable; one constraint made the shape non-obvious.
The `main` ruleset (ADR 0006) requires the status check named `checks`, and the
natural-looking design — `on.pull_request.paths: ['supabase/**']` so ordinary
PRs don't pay for Docker — is a trap the moment anyone makes the new job
required. GitHub does not create a check run for a workflow skipped by path
filtering, so the requirement is never satisfied and every PR that doesn't touch
`supabase/**` hangs on "Waiting for status to be reported" forever. GitHub says
so outright: "You should not use path or branch filtering to skip workflow runs
if the workflow is required to pass before merging."

Job-level `if:` skips *are* treated as satisfied, which suggests a `changes`
detection job plus `needs:` + `if:`. That works, but it fails open: if the
detection job errors, the dependent job is skipped, skipped counts as passing,
and the migration sails through ungated — the precise failure this ADR exists to
prevent, reintroduced one level up.

## Decision

Add a **second job `db-tests`** to the existing `.github/workflows/ci.yml`.
`checks` is untouched — same name, same steps — so the ruleset keeps working.

`db-tests` **always runs**. The `supabase/**` filter is a *step* (`git diff`
against the base sha), and the expensive steps carry `if: steps.filter.outputs.run
== 'true'`. This gets path filtering where it pays — only DB changes boot
Postgres; other PRs finish in ~15s of checkout — without ever depending on skip
semantics. The job always reports a real success or failure, so it is safe to
require, and it **fails closed**: an unresolvable base sha (force-push, first
push) runs the suite rather than waving the PR through on a filter we couldn't
evaluate.

Mechanics: `supabase/setup-cli@v3` pinned to `2.109.0` (not `latest` — a CLI
release must not be able to redden a gate on an unrelated PR), then
`supabase db start` + `supabase test db`. `db start` boots Postgres alone and
applies the migrations from scratch; `supabase test db` only ever talks to
Postgres, so the full stack would be minutes of waste per run. Docker is
preinstalled on `ubuntu-latest`.

**`db-tests` became a required check on 2026-07-17** — added to the `main`
ruleset alongside `checks` right after this PR merged (repo-admin action per
ADR 0006, done at Oleksandr's direction). From that date the gate blocks, not
just reports.

## Consequences

- A migration PR that breaks RLS or the schema now goes red on its own PR.
  Verified the gate can actually fail, not just pass: stubbing
  `cross-workspace asset insert blocked by RLS` red on a scratch commit turned
  the job red in CI, and reverting turned it green.
- Non-DB PRs pay ~15 seconds. That is the price of a requirable check; a
  trigger-level filter would cost 0s and deadlock the ruleset.
- ~~**Action for Oleksandr:** add `db-tests` to the `main` ruleset's required
  checks.~~ Done 2026-07-17 — the gate is no longer advisory. (The advisory
  window is where ADR 0013 already got burned — the convention is what failed,
  not the tests.)
- The CLI pin will drift. Bumping is one line; the alternative is a gate whose
  behaviour changes without a commit.
- `supabase test db` still works locally exactly as before; ADR 0013's
  "migrations owner runs it locally" is now a fast pre-flight rather than the
  only line of defence.
