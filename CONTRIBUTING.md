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
protection): CI (`checks` — lint, typecheck, build) must pass, and force-pushes
and branch deletion are blocked. Only the repo admin (`slobodskyi`) is on the
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
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all pass.
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
The database schema arrives in **Phase 0** (`docs/PLAN.md`), not later. One dev is
the **migrations owner** for the build: all schema changes go through them and land
**PR-only** — never applied ad hoc against the shared database. (This supersedes the
earlier "daily check-in rotation" idea; TECH_SPEC §11 pins a single owner to avoid
two people racing migrations on one database.) Assign the owner when Phase 0 starts.

## Documenting decisions
Non-obvious architectural choices go in `docs/decisions/` as a short ADR
(template in that folder — Nygard format: Title, Status, Context, Decision,
Consequences). Write one whenever a PR review surfaces a "why did we do it this
way" question, or before making a call the other person would reasonably want
to weigh in on.
