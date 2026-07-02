# 0001. Inline styles over Tailwind utility classes for ported UI

Date: 2026-07-02

Status: Accepted

## Context

We're porting a pixel-precise Claude Design mockup to Next.js. Most of the
source's styling is computed/state-driven (positions from layout algorithms,
colors from hashed palettes, `color-mix()` calls) rather than static
class-able values.

## Decision

Elements ported directly from the source design keep their original
`style="..."` as a React inline `style={{}}` object (camelCased, CSS custom
properties like `var(--bg)` preserved as string literals), rather than being
rewritten as Tailwind utility classes. Tailwind is still installed and fine
to use for genuinely new, non-computed, structural styling (e.g.
`className="absolute"` is a safe 1:1 swap) — just don't force-fit
computed/pixel-tuned values into it.

## Consequences

Component files read less "Tailwind-idiomatic" and are more verbose, but
pixel fidelity to the source is guaranteed with zero drift risk. Revisit
this decision only if we deliberately redesign a screen rather than port it.
