# 0043. Artboards become content packs — "Connect", then generate new files

Date: 2026-08-10

Status: Superseded by [0044](0044-workspaces-replace-artboards.md) — artboards were
removed and their working-surface + content-pack role moved onto Workspaces.

Builds on [0034](0034-canvas-groups-folders-and-artboards.md) (artboards are a
client-only rect over the canvas) and [0041](0041-annotations-carry-their-own-geometry.md)
(the one canvas object that lives on the server). Reuses the AI pipeline of the
`analyze` job and the embeddings it writes.

> **Note for the next agent (Oleksandr's Claude):** the frontend half of this is
> already on `main` when you read this. The **backend half described below is not
> built** — this ADR *is* your spec. Everything under "What ships now (frontend)"
> exists; everything under "What the backend must build" is yours. Migrations are
> yours and land PR-only (CONTRIBUTING.md).

## Context

An artboard today is a labelled rectangle in `localStorage` (ADR 0034): it frames
a set of tiles, exports them to a PDF, moves and deletes as one. It has no meaning
beyond "these files sit together on the board."

The product wants more: an artboard should be able to become a **content pack** —
the app *reads* every file in it, understands that they are one body of work, and
then lets you **create a new file** synthesised from them. The motivating use case:

> Drop in 4 photos, a voice message, a sticky note and a PDF. Click **Connect**.
> The AI reads them all, recognises they are one content pack, draws the
> relationships, and offers a ＋ to generate a new file (a text write-up, a PDF, …)
> grounded in all of them.

This is a nodes-and-edges idea: the files are nodes, "Connect" builds the edges and
the shared understanding, and generation reads the whole graph.

The forces:
- Artboards are **client-only**. A content pack's AI understanding and its generated
  files must **persist and sync** — so the pack needs a server representation.
- Members are **heterogeneous**: an image asset, a sticky-note annotation, a voice
  file, a PDF. The model must reference all of them.
- We must not block the frontend on the backend. The visual (mesh + ＋) is cheap and
  ships now; the intelligence follows.

## Decision

Split the feature at the client/server seam.

### What ships now (frontend — already implemented)
- An artboard becomes a content pack **automatically** once it holds **≥2 files** —
  there is no Connect button and no manual step. (An earlier revision had a CONNECT
  button and drew an all-to-all mesh between the tiles; both were removed — the
  button because connection should be implicit on file-add, the mesh because it
  fought the Topic view's own lines for meaning. `Frame.connected`, `artboardMesh`
  and the `ArtboardConnections` overlay are gone.)
- `FrameOverlay` shows a **＋** on any artboard with ≥2 files; its menu (`Text file`,
  `PDF document`) calls `createPackFile(frameId, format)` (`hooks/useWorkspace.ts`) —
  today a `flashToast` stub.
- No new asset ids, no server calls yet. "Which files are in the pack" is derived
  client-side from the artboard rect (`frameContentIds`).

### What the backend must build

**1. Server model for a pack.** A new migration (Oleksandr):
- `content_packs` — `id`, `workspace_id`, `project_id`, `label`, `summary text`
  (the synthesised understanding), `embedding vector`, `status` (`pending` |
  `ready` | `failed`), timestamps. RLS scoped by workspace like every other table.
- `content_pack_members` — `pack_id`, and a member reference that is **one of**
  `asset_id` (photo/voice/pdf asset), `annotation_id` (a sticky note, ADR 0041), so
  the pack can hold everything an artboard frames, not just photos.
- `content_pack_edges` — `pack_id`, `a_member`, `b_member`, optional `weight`. The
  frontend draws all-to-all today; the backend may store weighted edges from the
  analysis and the client can render those instead.
- Because artboards are client geometry, the **client sends the membership** on
  connect (the ids it framed); the server does not derive it from coordinates.

**2. `POST /api/artboards/connect`.**
Body: `{ projectId, label?, members: [{ kind: "asset" | "note", id }] }`.
Creates a `content_packs` row (`status='pending'`) + members, enqueues a **`pack`**
job, returns the pack id. The frontend will then track it over the existing
`ai_jobs` Realtime channel (`hooks/useJobProgress.ts`) and, when ready, GET the pack
to draw server edges and enable the ＋.

**3. `pack` worker handler.** Reads each member by kind — image → its existing
analyze tags/description + embedding; voice → transcript (new capability); pdf →
extracted text; note → `body.text` — then one Gemini call to synthesise a pack
`summary` + relationships (the `GEMINI_ANALYZE_MODEL`, never a hardcoded
generation, per ADR 0010), writes `summary`, `embedding`, edges, `status='ready'`.

**4. `POST /api/artboards/[packId]/generate`.**
Body: `{ format: "text" | "pdf" | … }`. Enqueues a **`generate`** job that produces a
new file grounded in the pack summary + members, stores it in R2, creates a new
`asset`/`files` row, and returns it so the frontend drops a new tile onto the
artboard (its position is client geometry — the client places it).

**5. Two new `jobTypeSchema` members** in `packages/shared`: `pack` and `generate`,
each with a worker handler. AGENTS.md's "seven handlers, one per member of
`jobTypeSchema`" becomes **nine**; the pgTAP `db-tests` and the handler-count
invariant update with them.

**6. Credits** (`packages/shared/src/usage.ts`): `pack` costs 1 per analysed member
(it is real AI work per file); `generate` costs 1 per produced file. Keep the unit
definition the single source both worker and web import.

## Consequences

- **Easier:** an artboard stops being a dead rectangle and becomes the unit of
  synthesis the product is really about; the frontend already speaks the language
  (mesh + ＋), so the backend can land incrementally behind a flag without more UI
  work.
- **Harder / given up (for now):** voice transcription and pdf text extraction are
  new worker capabilities the `pack` handler needs; until the backend lands, the ＋
  only toasts and `connected` is a per-browser flag that does not sync (a second
  device won't see the mesh). Accepted deliberately — shipping the visual first is
  what lets us validate the interaction before investing in the pipeline.
- The membership-comes-from-the-client rule means a stale client could send ids for
  files since deleted; the `connect` route must validate every member against the
  caller's RLS scope and drop the rest, exactly as `POST /api/exports` does with its
  id list.
