# 0006. Protect main with a repo ruleset, not classic branch protection

Date: 2026-07-06

Status: Accepted

> **Bypass scope (decided 2026-07-06):** only the repo admin (`slobodskyi`) is on
> the bypass list. `gangsta-george` (write) intentionally does **not** get direct
> push rights to `main` — they land changes via the PR flow, which is the default
> anyway. Adding a second bypass actor later is a one-line ruleset change if the
> team ever decides otherwise.

## Context

`main` was guarded by GitHub's classic branch protection: a required status
check `checks` (the CI workflow — `lint` + `tsc --noEmit` + `build`) with
"Include administrators" turned off. That last setting created an asymmetry —
the repo admin could push directly to `main` (bypassing CI), while the other
maintainer, who has write (not admin), could not push at all and was forced
through pull requests.

Classic branch protection has no per-user bypass list; its only escape hatch is
"admin + include-admins-off," which is all-or-nothing. We want CI to gate
everyone by default, with a **per-user** break-glass bypass we can grant (or
withhold) individually — without handing out full admin.

## Decision

Replaced classic branch protection on `main` with a repository **ruleset**
(named `main`, enforcement `active`) that:

- requires the `checks` status check (strict / branch-up-to-date), and
- blocks force-pushes (`non_fast_forward`) and branch deletion (`deletion`),

with a **bypass list** that names only the repo admin (`slobodskyi`;
`actor_type: "User"`, `bypass_mode: always`). The second maintainer
(`gangsta-george`, write) is deliberately not on it — see the bypass-scope note
at the top.

Classic branch protection was deleted only after the ruleset was created and
verified, so `main` was never left unprotected during the switch.

## Consequences

- The repo admin can push directly to `main` (the required check is
  **informational** for them — CI still runs but doesn't block); everyone else,
  including `gangsta-george`, is gated by CI and goes through PRs.
- CI still **blocks** any actor not on the bypass list (the second maintainer,
  pull requests, any future collaborator), so `main` stays gated for everyone
  but the admin.
- The bypass is ruleset-wide, so the admin can also force-push and delete `main`.
  Accepted risk for a trusted admin; to lock those down even for the admin, move
  `non_fast_forward` + `deletion` into a second ruleset with no bypass actors.
- Direct push is an escape hatch, not a mandate — the PR flow in
  `CONTRIBUTING.md` stays the default so CI actually gates and changes still get
  a second pair of eyes.
- Protection lives in GitHub settings (the ruleset), not in-repo config. There
  is no ruleset-as-code here; changing protection means editing the ruleset, not
  a file in this repo.
