# 0053. Share scopes and details: one link, three answers to "what am I sharing"

Date: 2026-11-12

Status: Accepted — amends ADR 0051 (§1, §4, §6, §10, §12)

## Context

ADR 0051 gave a project a live, no-account link. It answers one question only:
"share this project". Three gaps showed up as soon as it shipped:

- **What is on screen is not what leaves.** The canvas header's SHARE stays
  visible inside an open Workspace, and still shares the whole project. Someone
  looking at the 48 files of "Kyiv" sends a link to all 412.
- **Nothing smaller than a project can be shared.** A Workspace — the app's own
  name for "this subset, for this purpose" (ADR 0044) — has no link, and neither
  does a hand-picked selection, which is how a photographer actually answers
  "send me the ones from Tuesday".
- **The recipient sees files and nothing else.** ADR 0051 §6 sends no tags,
  labels or captions, on purpose: a link is files, not the archive. But an
  owner who triaged a shoot by colour, or wrote agency captions for an editor,
  has no way to share that work deliberately.

The codebase already holds the pieces:

- **Three sets that look alike** — the project, a Workspace (`boards` +
  `board_assets`, trashable since ADR 0044's amendment) and a canvas selection.
- **Download already resolves them** (ADR 0035): `openExportFor` takes the
  selection, else the open Workspace, else the right-clicked tile. A second rule
  for sharing would teach the same person two answers to the same question.
- **Every detail has its own nature.** A colour label is a human mark
  (ADR 0040). Tags are model output that feed Topic and search. Captions exist
  per language × style and may be human-edited (`is_edited`). Facts are
  unreviewed model output that ADR 0035 already refuses to print in a PDF.
- **ADR 0049's rule for counts**: a page that loads 200 rows at a time cannot
  assemble an honest total in the browser.

## Decision

### 1. A link has a scope, always inside its one project

| Scope | Carries | Lives |
|---|---|---|
| `project` | every active file of the project | grows and shrinks with the project |
| `board` | the active files of one Workspace of the project | follows the Workspace's membership |
| `selection` | a fixed list of files picked at creation | never grows |

The three are ordered by how "live" they are, and that ordering is the advice
the product gives: a list that should keep growing is a Workspace, so share
the Workspace.

- `project_shares` gains `scope` (default `project`) and `board_id`. A
  selection's list is `project_share_assets(share_id, asset_id)`, written once,
  in the same transaction as the link. Ids that are not live in the project are
  dropped at creation, never stored; a list of nothing is refused.
- **A list never grows, but it is not a snapshot.** A listed file that leaves
  the project or goes to Trash leaves the link; a Restore brings it back. The
  bytes are never copied (unlike ADR 0046).
- **A list cannot receive files** (a table CHECK, not only the RPC): an upload
  would land nowhere the recipient could ever see again.
- The 25-live-links bound stays per project, across all scopes.

### 2. One definition of liveness, one definition of content

ADR 0051 §4 put liveness in one function. Content now gets the same treatment:

- `project_share_is_live(project_shares)` is §4's rule, now a function
  `project_share_by_token()`, `list_project_shares()` and
  `list_project_share_counts()` all ask — plus one clause: **a Workspace link
  lives only while its Workspace is out of Trash.** Trash pauses the link,
  Restore resumes the same URL. A Workspace deleted for good sets `board_id` to
  null (SET NULL, not CASCADE), so the link is dead but its upload ledger and the
  provenance of what arrived through it (`assets.received_share_id`) survive.
- `project_share_scope_assets(project_shares)` is the only place that says
  which files a link carries. It starts from the project's active files and can
  only narrow them, so **no scope can widen what ADR 0051 exposed**. The page's
  count, the listing, media resolution and the ZIP all join it; none checks
  `project_assets` on its own any more.

### 3. Details are opt-in per link, and SQL enforces them

Four switches, all off by default, so a link made the ADR 0051 way still shows
files and nothing else:

| Switch | Recipient sees | Constraint |
|---|---|---|
| `show_boards` | the project's Workspaces as a filter row | project scope only |
| `show_labels` | each file's colour dot, and a colour filter | — |
| `show_tags` | each file's tag names, and a tag filter | — |
| `caption_lang` + `caption_style` | that one caption per file | both or neither |

- **Details need download rights** (CHECK): an upload-only link shows no files,
  so it can show nothing about them.
- **A detail that is off comes back null**, from the resolver itself, not
  hidden by the page.
- **A filter on a detail that is off is refused** (`22023`, which the route
  turns into its one 404). Otherwise the filter answers the question the null
  was hiding: "does anything here carry red?".
- **Workspaces as a filter is a project-link detail.** On a Workspace link the
  Workspace *is* the scope; on a list it means nothing. A Workspace's name
  crosses only as that filter, or as the title of the Workspace being shared.
- **Tags are names only**: at most 24 per file, strongest first, deduplicated
  across categories (a "river" object and a "river" scene are one word to a
  reader). Confidence and category stay inside.
- **The caption is exactly the chosen language and style**, with no fallback:
  a caption in another register is not what the owner chose to send.
- **Still never sent:** AI descriptions, facts (unreviewed model output asserted
  to a third party — ADR 0035's reason for keeping them out of the PDF),
  location, notes, member names, other projects.

ADR 0051 §6's default stands. What changes is that the default is now a
default, and leaving it is a recorded decision per link.

### 4. The filter row is counted in SQL

`list_project_share_facets(token)` returns, for the details that are on only,
the Workspaces (in their own order), the colours, and the 40 most-used tag
names, each with how many of the link's live files carry it. It is a
service-role-only resolver like every other one in ADR 0051 §5.

### 5. A file sent through a Workspace link lands in that Workspace

`complete_project_share_uploads()` adds it to the Workspace (after the last
member) as well as the project.

Ingest needs no change for this. A dedup merge moves **project** membership
onto the surviving asset, and the duplicate's Workspace membership dies with the
duplicate. So a stranger holding the bytes of a project photo that sits outside
the Workspace can never pull it into the Workspace, and ADR 0051's amendment
(merge only inside the link's project) stays the whole rule. The delivery still
counts in the link's "files received" either way.

### 6. The editor's side gains three answers

- `list_project_shares()` adds the scope, the Workspace's name and colour, how
  many files the scope holds right now, and which details are on.
- `list_project_share_scope(share_id)` lists what a link carries now, for "Show
  on canvas" on any link. `list_project_share_received()` stays separate: that
  is what *arrived*, this is what is *shown*.
- `list_board_share_counts(project_id)` marks a Workspace chip that is reachable
  from outside, as the project card already is (ADR 0051 §12).

### 7. One dialog, one rule of entry

Every Share opens the same dialog (`ShareDialog`, the generalised
`ShareProjectDialog`), and the starting scope follows Download's rule:
**the selection, else the open Workspace, else the project**. The first row of
the dialog names that scope with its file count and lets the owner switch to a
wider one. Entry points:

- the hub card's **Share…** — the project;
- the canvas header's **SHARE** — contextual, badged with the selection count,
  as DOWNLOAD already is;
- the canvas right-click menu's **Share N…**, beside Download — the selection,
  else the tile under the pointer;
- a Workspace chip's menu — **Share workspace…**.

There is no share from the `all` canvas: it has no project.

The link list in the dialog shows every link of the project with its scope, so
the owner can see at a glance what is reachable from outside and through what.

### 8. Shipped as a compatible schema first

Every changed function only **appends** parameters, all defaulted, and only
**appends** result columns. The web build already deployed (whose row parsers
are non-strict) keeps working against the new schema, so the migration lands
first and the UI follows in separate PRs.

## Consequences

- What a link shows now depends on its scope, and the dialog's warning ("a live
  link shows whatever … holds now") names the project, the Workspace, or "these
  N files" accordingly.
- A link's scope and details are fixed at creation. Changing them means a new
  link and turning the old one off; a URL someone already holds never quietly
  starts showing more.
- A Workspace becomes something reachable from outside. Trashing it pauses its
  links, which is the expected reading of Trash; deleting it for good ends them.
- A list is capped at 2,000 files, the same number as a link's upload quota.
- The ZIP through a link is still the files only — no `captions.csv`. Captions
  are read on the page.
- Out of scope: password-protected links (ADR 0051's follow-up), editing a
  link's scope or details, facts, location and notes on the page, sharing from
  the `all` canvas.
