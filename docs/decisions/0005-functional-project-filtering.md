# 0005. Project switching really filters photos, deviating from source

Date: 2026-07-02

Status: Superseded by 0006 (v2 redesign has no project concept at all)

## Context

The original mockup computes a per-project photo filter but never applies it
anywhere in rendering (dead code) — selecting a project only changes which
view renders and the header label, not which photos are visible. It also
shows hardcoded fake project counts in the project dropdown, unrelated to the
actual mock photo data.

## Decision

We deliberately deviated from pixel/behavior-perfect source fidelity here:
Timeline, Map, and Sense views now consume a real project-filtered photo
list, the project dropdown shows live counts computed from actual photo
data, and "Add to Project" really reassigns the selected photos' project
field (not just a toast).

## Consequences

This makes project-switching demonstrably work end-to-end, which is more
convincing as a product demo — but it's a narrow, explicit exception to the
general "port faithfully" rule (see 0001, 0003). Don't treat this as license
to make other cosmetic/fake behaviors "real" without a similarly explicit
decision and ADR.
