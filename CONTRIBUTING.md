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

## When we add a database (Phase 2)
Only one of us runs migrations against the shared/shared-preview database at a
time — agree in a quick daily check-in who's touching schema that day. Update
this section with the actual rule once Supabase is wired up (link to the
relevant ADR once one exists).

## Documenting decisions
Non-obvious architectural choices go in `docs/decisions/` as a short ADR
(template in that folder — Nygard format: Title, Status, Context, Decision,
Consequences). Write one whenever a PR review surfaces a "why did we do it this
way" question, or before making a call the other person would reasonably want
to weigh in on.
