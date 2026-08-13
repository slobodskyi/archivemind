# ADR 0045 — Workspace content drafts separate creation from file export

Date: 2026-08-13
Status: Accepted (browser-local MVP)

## Context

A Workspace (`board` in code) is a stable, curated subset of one project's
files (ADR 0044). The existing export dialog answers a narrower job: render an
explicit asset list as PDF/captions CSV, or package files in a ZIP. It does not
create a cross-photo story, and the retired artboard cannot be reused as page or
slide membership because its membership was inferred from temporary canvas
geometry.

The creator's actual job is outcome-first: choose ten photos and turn them into
an article, or choose five and turn them into an Instagram carousel. Generated
copy must then be reviewable and editable before it becomes a deliverable.

## Decision

The product model is:

`Workspace (source scope) → Content draft (editable snapshot) → Delivery`

- An open Workspace exposes three distinct actions: **Create** (generate new
  material), **Drafts** (return to saved editable material), and **Download**
  (the existing PDF/CSV/ZIP source-file flow).
- Create is outcome-first. The first recipes are **Article** and **Instagram
  carousel**. The user chooses selected files or the whole Workspace, supplies a
  brief, audience, language and tone, then recipe-specific image/slide options.
- Every draft captures an ordered `sourceSnapshot` of asset ids. Later Workspace
  membership changes mark **Sources changed**; they never silently mutate or
  regenerate an existing draft.
- A draft owns its structured order: article sections and placed assets, or
  ordered carousel slides. Canvas coordinates and Workspace membership order
  are not a durable publication sequence.
- Generation is a user-triggered authenticated `POST
  /api/content-drafts/generate`. It accepts at most 20 ordered board members,
  verifies owner/editor access and active membership before the model call, and
  returns one schema-constrained object. The model name comes from
  `GEMINI_ANALYZE_MODEL` through the existing `analyzeModel()` seam.
- The prompt admits only confirmed facts for specific claims. EXIF time/place
  are evidence; AI description/tags are visual hints; only human-edited captions
  may be used as writing references. Generated material remains explicitly a
  draft and must be reviewed.
- Manual writes are autosaved with optimistic `version` and
  `manualEditVersion` tokens. A late generated response cannot overwrite text
  edited while it was running. Whole-draft regeneration creates another draft
  rather than replacing the edited one.
- Delivery stays honest in the MVP: article copy downloads as Markdown,
  carousel copy as text, and used source photos open the existing lossless
  Download flow. A future combined rendered ZIP is a renderer feature, not a UI
  label over two unrelated files.

## Persistence and migration boundary

This first slice stores the versioned draft envelope in `localStorage`, keyed by
`boardId`. That is an explicit limitation, not the target multi-device model.
Repository policy requires schema migrations to land through the migrations
owner in a separate PR; this feature therefore introduces no ad-hoc production
table.

The browser schema is deliberately shaped like the future durable domain:
discriminated article/carousel content, source snapshot, brief, settings,
version tokens and timestamps. The server-backed follow-up should adopt that
shape in a `content_drafts` domain with version history and export artifacts,
then migrate browser drafts through an explicit user-visible adoption flow.

## Usage accounting

One successful multi-photo generation writes `usage_events.event_type =
'content_generated'`, `units = 1`, and the resolved model. Its credit price is
temporarily zero because the existing public credit unit is “one AI action on
one photo” and there is no approved conversion for a set-level synthesis. We
record the event now and do not invent a user charge. Pricing it and including
it in `workspace_usage()` requires a separate product decision plus migration.

## Consequences

- One Workspace can produce multiple outputs and versions without being locked
  to a permanent “type”.
- Editing and delivery survive the retirement of artboards because both use
  explicit asset ids and explicit document order.
- Browser-local drafts are not available on another device and can be lost when
  site storage is cleared. The Drafts UI says this directly.
- Generation is synchronous in this MVP. Moving it to a durable worker job is
  appropriate if real latency regularly outlives a route request; the saved
  draft contract and optimistic tokens remain valid.
- The existing export worker, progress UI, presigning, retention and purge rules
  remain unchanged for PDF/CSV/ZIP downloads.
