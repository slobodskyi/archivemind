# 0049. The Trash is one typed list, and nothing soft-deleted lives outside it

Date: 2026-08-21

Status: Accepted

## Context

Four tables carry a soft delete on a 30-day clock: `projects` (0019),
`assets` (ADR 0033), `boards` (ADR 0044) and `content_drafts` (ADR 0045's
amendment). They were surfaced by three different pieces of UI and, in one case,
by none at all:

- the homepage Trash view listed trashed **projects** as project cards and
  trashed **photos** as a second grid below them;
- the in-canvas Trash panel listed trashed **Workspaces** and, again, photos;
- trashed **drafts** appeared nowhere. `content_drafts.deleted_at` had no sweep
  either, so a "deleted" draft was kept forever and shown to no one.

Neither surface could answer the questions a trash exists to answer. Given a row,
you could not tell what kind of file it was (`asset_kind` has had
`photo | pdf | document | other` since day one, and every one of them rendered as
a photo card with "No preview"), where Restore would put it back, how much space
deleting it for good would free, who deleted it, or what was about to expire
first. There was no sort, no filter, and the only search was the homepage's
sidebar box — labelled "Search projects…" while also filtering the photo grid.

Three further things were wrong in a way that only shows up at scale or in a
hurry:

1. **The read was capped at 500 rows with no total.** The list silently
   truncated, and "Empty trash" then purged the first 500 and left the rest.
2. **"Empty trash" ignored the active search.** A list showing 3 of 300 had a
   button that deleted all 300.
3. **The bulk endpoints existed and were unused.** `POST /api/assets/restore`
   has accepted 500 ids since ADR 0033, while the UI sent them one at a time —
   so undoing a batch delete of forty photos meant forty clicks. A trashed
   *project* could not be deleted permanently at all; the only way past it was to
   wait 30 days.

## Decision

**1. One list, one item model.** A `TrashItem` is a discriminated union over
`project | workspace | asset | draft`, carrying name, thumbnail, size, location,
deleted-at, deleted-by and expiry in one shape (`packages/shared`,
`trashItemSchema`). Both surfaces render it: the homepage view in full, the
in-canvas panel as a narrower slice. `trashDaysLeft()` is one function in
`packages/shared` — the two surfaces had each grown their own, and one of them
hardcoded the 30.

**2. The chip key is the kind, except for an asset, where it is the asset's own
kind.** So the filters are `Photos · PDFs · Documents · Other files · Projects ·
Workspaces · Drafts` without `asset` ever being a chip, and a future member of
`asset_kind` becomes a chip with no change to the SQL, the schema or the UI.

**3. Filtering, sorting, paging and counting happen in the database**, in
`trash_items()` — a SECURITY INVOKER function over a `union all` of the four
tables (migration `20260821000001`), the same posture as `workspace_usage()`.
Sorting by size across four tables, an honest total, and a page you can walk
cannot be assembled in the browser without first reading everything, which is
precisely what the 500-row cap got wrong. The function returns R2 **keys**; the
route presigns only the page it renders, so a 500-item Trash no longer signs 500
objects to draw 60.

**4. A destructive button may only act on what the filter matches — and must say
the number.** With no filter it reads "Empty trash"; with one it reads
"Delete all (N)", and the ids are collected across pages before the confirmation
names that N. This is ADR 0033's copy discipline extended one step: the label,
the confirmation and the effect have to agree.

This is deliberately the OPPOSITE of the label filter's rule (ADR 0040), where
filtering hides tiles and every action still sees the real set. The difference is
what the two filters are for: a canvas filter is a way of looking at an
arrangement you are still working on, while a Trash filter is how you pick the
thing you are about to destroy.

**5. `deleted_by` is stamped by a trigger, never by a route.** Same reasoning
ADR 0033 used for `deleted_at`: `assets` has four status writers (delete route,
restore route, import re-pick revive, ingest dedup revive), and the actor must
not depend on which one ran. `stamp_asset_deleted_at` gained the column;
`projects`, `boards` and `content_drafts` get a generic `stamp_deleted_by()`
keyed on the `deleted_at` transition their routes already write. A restore clears
it — "deleted by Anna" on a live project reads as an audit trail of something
that did not happen.

**6. Nothing soft-deleted exists outside the Trash** — which is what forced
`sweep_trashed_drafts()`. Listing drafts without a sweep would have printed a
30-day countdown that never ran out. Publication links are untouched: a
`/p/{token}` carries its own snapshot and refers to its draft by plain text,
deliberately not by a foreign key (ADR 0046).

**7. Mixed selections get their own endpoints.** `POST /api/trash/restore |
/purge | /delete` take `(kind, id)` pairs and fan out server-side, because
"restore" is genuinely per-kind — a photo comes back by flipping a status enum, a
project by clearing a timestamp, and a photo is *purged* by enqueuing a worker
job rather than by a DELETE. One request, one toast, one confirmation. `/delete`
is the inverse of `/restore` and exists so a restore can be undone: the delete
has offered an Undo since ADR 0033, and the restore never did.

Permanent deletion of a trashed **project** arrives with those routes. Every hard
delete is guarded on `deleted_at is not null`, so a stray id is a no-op rather
than data loss.

**8. Workspaces stay on the header's own board state in the panel.** The panel
reads `/api/trash` for files and drafts but keeps rendering `bd.trashedBoards`
for Workspaces, because restoring one has to put its chip back in the breadcrumb
on the same frame — `useBoards` owns that optimistically (ADR 0044). They remain
absent from the homepage view for the reason ADR 0044 gave: a Workspace belongs
to one project, and the homepage has no project to scope it to.

## Consequences

- The Trash answers "what is this, where does it go back to, how big is it, who
  deleted it, what goes first" — and the storage line finally appears in the one
  place ADR 0037 pointed at when it put Usage & Storage directly above Trash in
  the sidebar. The bytes are counted exactly as `workspace_usage()` counts them,
  so the Trash total and the storage card's `trash` slice cannot disagree.
- `GET /api/assets?scope=trash`, `getTrashedAssets`, `trashedAssetSchema` and
  `TrashedPhotoCard` are gone; `useWorkspace` no longer holds a trash list at
  all. The panel is a slice of one model rather than a second implementation.
- A trashed project's card is no longer a `<Link>`, and neither is an archived
  one: `/projects/[id]` builds its guard from active projects only, so both
  bounced to the homepage. The archived case was a real bug, not a Trash one;
  letting an archived project actually open needs a second read in that page's
  guard and is deliberately left out of this change.
- `trash_items()` is one query over four tables. At today's scale it is a handful
  of index scans; when it stops being that, the body changes and `lib/trash.ts`
  keeps its shape — the same escape hatch `workspace_usage()` documented.
- `supabase.rpc()` is untyped, so the function's result is **zod-parsed** in
  `lib/trash.ts` and its signature is pinned by pgTAP (`021_trash_items.sql`). A
  drifted signature otherwise compiles clean and 500s in production.
- Search is still name-only. Trashed assets keep their tags and captions until
  purge, so a hybrid search over the Trash is possible later; it is not here.
- Restoring an asset whose projects are all trashed shows "No project" rather
  than naming a destination the photo cannot be seen in — honest, but it does
  mean such a photo returns to the all-files canvas alone.
