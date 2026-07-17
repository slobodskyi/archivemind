# Contributing

Two of us, both working with AI coding agents (Claude Code or similar). This doc
exists so we don't overwrite each other's work or diverge on conventions an agent
can't infer on its own.

## Branching
- Trunk-based: `main` is always deployable. Branch per feature/fix, short-lived
  (merge within a day or two where possible).
- Branch naming: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`,
  `chore/<short-name>`.
- Rebase your own branch onto `main` before opening a PR. Never rebase a branch
  the other person has already pulled from.
- Squash-merge into `main`; delete the branch after merge.

## Branch protection
`main` is protected by a GitHub repository ruleset (not classic branch
protection): CI must pass — both `checks` (lint, typecheck, test, build) and
`db-tests` (the pgTAP suite; ADR 0020) — and the branch must be up to date with
`main` (a PR that falls behind shows `BEHIND` and must be rebased before it will
merge), and force-pushes and branch deletion are blocked.
Only the repo admin (`slobodskyi`) is on the
ruleset's **bypass list**, as a break-glass escape hatch — everyone else,
including `gangsta-george`, lands changes through the default flow: branch → PR →
green CI → review → squash-merge. That's by design (nobody bypasses CI as a
matter of routine). See `docs/decisions/0006-branch-protection-via-ruleset.md`.

## Parallel work with git worktrees
Claude Code supports isolated sessions via worktrees, so two Claude sessions
(yours and mine) never touch the same files on disk:

```
git checkout main && git pull
claude -w <branch-name>
```

A `.worktreeinclude` file (already in repo) copies `.env.local` into new
worktrees automatically once we have secrets to worry about. To clean up: list
worktrees with `git worktree list`, then `git worktree remove <path>` once a
branch is merged.

## Before opening a PR
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass (from the
  repo root; they fan out via turborepo). CI runs exactly these four.
- If you touched `supabase/**`, run `supabase db reset && supabase test db`
  locally as the fast pre-flight — CI runs the same pgTAP suites as the required
  `db-tests` check, so a red suite now blocks the merge on its own (ADR 0020;
  supersedes ADR 0013's local-only discipline).
- The diff does only what the PR describes — no unrelated drive-by changes.
- If an AI agent produced the diff, skim it yourself before pushing — see the
  review checklist in `.github/PULL_REQUEST_TEMPLATE.md`.

## Review
- The other person reviews every PR before merge once we're both actively
  committing. Solo self-merge is fine while only one of us is working, but turn
  this on as soon as we're both active.
- Use the PR template checklist — it's written to catch AI-specific failure
  modes (scope creep, hallucinated APIs, weakened checks), not generic style
  nits.

## Database migrations
**Migrations owner: Oleksandr (`slobodskyi`).** All schema changes go through him and
land **PR-only** — never applied ad hoc against the shared database. (TECH_SPEC §11
pins a single owner to avoid two people racing migrations on one database; this
supersedes the earlier "daily check-in rotation" idea.) If your work needs a schema
change, don't write the migration — open an issue titled `schema: <what>` with the SQL
you'd propose and what's blocked, and build around it in the meantime.

Migrations are **append-only**: once a migration is merged, treat it as immutable —
you don't know who has already applied it, and Supabase's ledger keys on the timestamp
prefix with no checksum, so editing a pushed migration means the fix silently never
re-applies. Add a new migration instead.

Pushing to prod is the owner's job and follows one rule: **only from a clean `main`
checkout, and always `supabase db push --dry-run` first** (`db push` reads the files on
disk and knows nothing about git — from a feature branch it will happily ship an
unmerged migration). Verify after with `supabase migration list --linked` **and**
`supabase db diff --linked` — `db push` has been observed printing a `pgdelta`
certificate error while having succeeded, so its own output proves nothing either way.

## Documenting decisions
Non-obvious architectural choices go in `docs/decisions/` as a short ADR
(template in that folder — Nygard format: Title, Status, Context, Decision,
Consequences). Write one whenever a PR review surfaces a "why did we do it this
way" question, or before making a call the other person would reasonably want
to weigh in on.
