# 0034. Canvas groups: folders + artboards share one server model; membership on the server, geometry on the client

Date: 2026-07-23

Status: Accepted

## Context

The canvas needed two grouping tools that users had asked for:

- **Folders** — combine files into a container to tidy the pile (organize an
  imported archive into "yoga", "trip", "clients", …).
- **Artboards** — gather chosen files into a working region that becomes a
  final deliverable (later exported as a PDF — ADR 0035).

The bottom action bar already shipped **"Group"** and **"Export"** buttons as
"coming soon" stubs, and **artboards already existed** as client-only `Frame`
rectangles (`lib/layout.ts`), persisted in `localStorage` with **no membership
model at all** — a tile "was in" a frame only by its center landing inside the
rect, recomputed live. That is fine for a purely visual frame, but a *folder*
needs durable "these files belong together", and an *artboard export* needs a
reliable, ordered member list the worker can read server-side. Neither exists in
a `localStorage` rect.

Two forces pulled in opposite directions:

- **ADR 0022** deliberately kept canvas *layout* (tile positions, frames, sticky
  notes) client-only in `localStorage` — positions are per-user view state, not
  shared data, and syncing them on every drag was rejected.
- A folder's/artboard's **membership** is not view state — it is data. It should
  survive a cache clear, be identical on another device, and (for export) be
  readable by the worker.

## Decision

**1. One server model for both, discriminated by `kind`.** New tables
`canvas_groups` (`kind ∈ {folder, artboard}`, `name`, `sort_index`, `settings`
jsonb, nullable `project_id`) and `canvas_group_assets` (`group_id, asset_id,
position`), migration `20260723000002`. RLS mirrors `projects` /
`project_assets` exactly (select = `is_member`, writes = `is_editor` /
`is_editor_of_asset`). Deleting a group cascades its membership rows only — the
assets survive, because a group is a curated **subset**, not a container of
bytes (same invariant as projects).

**2. Split membership (server) from geometry (client) — so ADR 0022 still
holds.** The server owns *what's in the group and in what order*; the browser
owns *where the folder/artboard box sits and whether it's collapsed*, in a new
`groupGeom` bucket of the same `localStorage` blob that already holds tile
positions. Nothing about canvas *layout* moved to the server; only membership —
which was never layout — did. A group created on another device shows up with a
deterministic default position until this browser places it.

**3. Single-folder-membership, enforced in the route, not the DB.** A file lives
in at most one folder per scope; adding it to a folder detaches it from sibling
folders. Artboards are exempt (they deliberately share assets across pages), so
a blanket `unique(asset_id)` would be wrong — the rule is folder-specific and
lives in `POST /api/canvas-groups[/…/assets]`.

**4. Folders render in-place; membership follows the drop.** Collapsed = a
thumbnail-stack tile that stands in for its (hidden) members; expanded = a
labelled region the member tiles sit inside. Dropping a Canvas tile inside a
folder joins it, dragging one out leaves it (`syncFolderMembership`), reusing
the existing gallery-drag machinery. Neural view only in v1 — Timeline/Map/Topic
ignore folders, exactly as they ignore frames.

**5. Artboards keep their client `Frame` for now.** Promoting the existing
frame to a server `canvas_groups` row of `kind='artboard'` is a follow-up; v1
exports artboards/selections via capture-at-export (ADR 0035), so the tables and
contracts already support artboards even though the client still draws frames.

## Consequences

- Organization is durable and shareable; the worker has a real ordered member
  list to export. The client seam is unchanged: reads via a new
  `lib/canvas-groups.ts` server reader, writes via `app/api/canvas-groups/*`.
- Two sources of truth per group (server membership + client geometry) must be
  reconciled on load; a group with no local geometry gets a deterministic
  fallback spot rather than (0,0).
- Membership mutations are optimistic + fire-and-forget: a failed fetch reverts
  on the next refresh rather than blocking the drag. Acceptable for a
  single-user MVP; a collaborative build would want confirmation/rollback.
- `canvas_group_assets` has a real `position` column (unlike `project_assets`),
  because artboard page order is meaningful — reused by ADR 0035.
