# 0003. Preserve source design "quirks" instead of silently fixing them

Date: 2026-07-02

Status: Accepted · **Superseded in part by [0016](0016-real-timeline-topic-map-views.md)**
— the Timeline `hash(photo.id)` bucketing quirk below was deliberately retired once real
assets carried real capture dates. The rest of this ADR still stands.

## Context

The original Claude Design mockup (the `.dc.html` prototype this repo ports
pixel-for-pixel) has several behaviors that read as bugs to a fresh pair of
eyes but are actually intentional (or at least deliberately preserved)
fidelity to the source spec. Two people are working on this codebase with AI
coding agents; without a written record, an agent that stumbles on one of
these is liable to "fix" it as a drive-by cleanup, silently diverging from
the source spec and creating churn neither maintainer asked for.

## Decision

Document and preserve the following rather than "fixing" them without
discussion first:

- Timeline column bucketing is `hash(photo.id)`-based, not derived from the
  photo's actual date field — a mockup shortcut to spread items across all 6
  months. **(Retired 2026-07-14 by [0016](0016-real-timeline-topic-map-views.md):
  Timeline now buckets on the real capture date. Do not restore this.)**
- Several Bulk AI operation toggles (caption languages/style, tags, faces
  checkboxes) are cosmetically wired but functionally ignored — every run
  produces the same canned output regardless of which are checked.
- The Photo Drawer's "Regenerate" caption button is a no-op beyond showing a
  toast — it doesn't actually change the caption text.
- Caption styles "Agency" and "Archival" render identically; only "Social"
  differs (it truncates to the first sentence and appends hashtags).
- The EXIF metadata block shows identical static values for every mock
  photo.
- The Photo Drawer's prev/next navigation cycles through the full
  unfiltered photo array (all mock photos), not the currently
  visible/selected set.

## Consequences

A contributor (human or AI agent) who notices one of these and wants to
"fix" it should check this list and, if a real fix is wanted, write a new
ADR explaining the deviation (see 0005 for an example) rather than changing
it silently.
