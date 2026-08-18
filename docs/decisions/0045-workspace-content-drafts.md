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

## Amendments

### 2026-08-14 — drafts become durable (migration `20260814000001`)

The Consequences above accepted that a draft "can be lost when site storage is
cleared", on the reasoning that a draft was a scratch artifact. Two things made
that untenable.

The first is what a draft actually contains: the text a person wrote. The rest
of the canvas keeps its state in `localStorage` under ADR 0022 because a tile
position is one user's *view* of data that exists on the server; the photo is
safe either way. A draft exists nowhere else, which is the same argument ADR
0041 used to move sticky notes — including their coordinates — to the server.
Applied consistently, it moves drafts too.

The second is [ADR 0046](0046-publication-share-links.md). A publication
outlives its draft and stores `source_draft_id`, so a cleared browser left a
live public link pointing at an id that no longer existed anywhere.

**`content_drafts` is the durable copy of record, and the browser still writes
`localStorage` first.** That ordering is deliberate and is not a hedge: the
editor autosaves on a debounce while somebody is typing, so making the save path
await a network round trip would make every keystroke's persistence contingent
on connectivity, and a dropped connection would then be *worse* than the
behaviour this amendment replaces. Instead the local write stays synchronous and
authoritative for the session, and `lib/content-drafts-sync.ts` mirrors it.
`saveContentDraft` remains the authoring path; `adoptContentDraft` is the
separate, deliberately dumb write used when the server copy is the newer truth,
because the authoring path bumps `version` on every write and would renumber a
draft simply for having been downloaded.

`client_id` stores the browser's own draft id rather than minting a server one.
That is what keeps an adopted draft attached to any publication already made
from it, and what makes the save an idempotent upsert — a retried autosave after
a dropped response cannot produce a second copy of one draft.

Conflicts resolve on the draft's `version`, never on `updated_at`: two tabs can
save inside one clock tick. A write whose version is behind the stored row
returns `stale` instead of winning, because the editor saves the whole document
and an older envelope would silently delete the newer one's paragraphs. Delete
is soft, so an Undo restores the same draft id — and with it the publication's
link to its source.

Drafts cascade with a hard-deleted board and survive a trashed one, matching the
30-day board window in ADR 0044: while the Workspace can still come back, its
drafts must come back with it.

Still out: cross-device *live* collaboration, presence, and per-field merge. Two
people editing one draft simultaneously will still resolve as last-writer-wins
at document granularity, and the UI does not yet show that a newer version
exists elsewhere.

### 2026-08-18 — two actions and a hub; one word per delivery job

The Decision above gave an open Workspace **three** actions — Create, Drafts,
Download. Shipping them showed the triad was one story wearing two names:
Drafts and Create are the same activity (make content) at different moments,
and the library dialog admitted as much by carrying its own "+ Create" button
in the header. Meanwhile the words crossed: the DOWNLOAD button opened a dialog
titled "Export", the studio's "Export copy" performed a download, and its
"Download photos" opened the Export dialog.

What ships now:

- **Two actions.** `Download` (source files as PDF/CSV/ZIP — unchanged flow)
  and `Create` (primary, carrying the draft count as a badge). Create opens a
  **hub** (`CreateHubDialog`): outcome cards on top — Article, Instagram
  carousel, and room for the next recipe — with **Continue editing**, the saved
  drafts, below. The separate DRAFTS button is gone. Create stays enabled when
  the Workspace has drafts but no files: the cards disable, the drafts remain
  reachable.
- **The brief step asks less.** `CreateOutputDialog` no longer picks the kind
  (the hub did) and fronts only the prompt and language; audience, tone,
  length/aspect and count sit behind a **More options** disclosure that names
  its current values and auto-opens when a regeneration seed carries any
  non-default. The studio is where the result gets shaped, so the form stops
  charging eight decisions before the first draft exists.
- **A predictable ladder.** hub → brief → studio, and Escape/Back walks it
  backwards one step at a time; closing the hub returns to the canvas. The old
  behaviour — Escape in the create form landing in the library only if drafts
  existed — is gone.
- **One word per delivery job** (landed 2026-08-18 with the vocabulary pass):
  *Download* moves files out of the app in any format — the dialog's title and
  CTA say Download, and the studio's "Export copy" + "Download photos" pair
  became one Download menu (Text / Photos). *Share* makes the public preview
  link. *Create* makes content. "Export" survives only in code, job types and
  API routes.

Consequences: `DraftLibraryDialog` is deleted in favour of `CreateHubDialog`;
the phone row carries two buttons instead of three. The generation contract,
draft schema, storage and usage accounting above are untouched.

One rupture remained after the hub landed and is closed now: the studio's
**Download → Photos** used to close the editor to show the download dialog,
stranding the author two dialogs away from their draft. It opens *over* the
suspended studio instead — the same mechanism Share already used — so a
delivery never closes the editor it delivers from.
