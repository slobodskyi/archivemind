# 0006. Protect main with a repo ruleset, not classic branch protection

Date: 2026-07-06

Status: Accepted — but see the drift note below.

> ⚠️ **Live-state drift (2026-07-06):** the decision below calls for *both*
> maintainers on the bypass list, but the live `main` ruleset currently names only
> `slobodskyi`. Until `gangsta-george` is re-added to the bypass list, they can push
> to `main` only via PR (CI-gated). Reconcile before both devs are active — either
> add them back (restores this decision) or amend this ADR to accept a one-person
> bypass.

## Context

`main` was guarded by GitHub's classic branch protection: a required status
check `checks` (the CI workflow — `lint` + `tsc --noEmit` + `build`) with
"Include administrators" turned off. That last setting created an asymmetry —
the repo admin could push directly to `main` (bypassing CI), while the other
maintainer, who has write (not admin), could not push at all and was forced
through pull requests.

Classic branch protection has no per-user bypass list; its only escape hatch is
"admin + include-admins-off," which we can't grant to a write collaborator
without making them a full admin. We want both maintainers to have equal push
rights to `main` while keeping CI as a gate for everyone else (pull requests,
future collaborators).

## Decision

Replaced classic branch protection on `main` with a repository **ruleset**
(named `main`, enforcement `active`) that:

- requires the `checks` status check (strict / branch-up-to-date), and
- blocks force-pushes (`non_fast_forward`) and branch deletion (`deletion`),

with a **bypass list** naming both maintainers individually
(`actor_type: "User"`, `bypass_mode: always`) — intended to be `slobodskyi` and
`gangsta-george`. (As of 2026-07-06 the live list has only `slobodskyi` — see the
drift note at the top.)

Classic branch protection was deleted only after the ruleset was created and
verified, so `main` was never left unprotected during the switch.

## Consequences

- Both maintainers can now push directly to `main`; the required check is
  **informational** for them — CI still runs on every push and PR, but does not
  block their pushes.
- CI still **blocks** any actor not on the bypass list (pull requests, any
  future collaborator), so `main` stays gated for everyone else.
- The bypass is ruleset-wide, so both maintainers can also force-push and delete
  `main`. Accepted risk for a two-person trusted repo; to lock those down even
  for us, move `non_fast_forward` + `deletion` into a second ruleset with no
  bypass actors.
- Direct push is an escape hatch, not a mandate — the PR flow in
  `CONTRIBUTING.md` stays the default so CI actually gates and changes still get
  a second pair of eyes.
- Protection lives in GitHub settings (the ruleset), not in-repo config. There
  is no ruleset-as-code here; changing protection means editing the ruleset, not
  a file in this repo.
