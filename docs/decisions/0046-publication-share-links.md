# ADR 0046 — Publication shares are immutable, anonymous snapshots

Date: 2026-08-13
Status: Accepted (migration `20260813000002`; production apply remains migration-owner work)

Builds on [0045](0045-workspace-content-drafts.md): a Workspace creates an
editable Article or Instagram-carousel draft in the browser. This ADR defines
the explicit **publish/share boundary** for that draft.

## Context

A draft can already be edited and downloaded by its author. The next job is
different: send a link to an editor, client or collaborator who has no
ArchiveMind account, let them read the work at a normal publication width, copy
the complete text, and download the photographs they are allowed to receive.

Making the live Workspace or the browser draft public would be wrong:

- a Workspace is a mutable source scope, so adding or removing a photograph
  would silently rewrite a link already sent to somebody;
- the draft envelope contains private production context — its brief, tenant /
  board ids, real asset ids, source snapshot and optimistic edit tokens;
- a normal Supabase session/RLS read cannot serve a person with no account, but
  making the underlying tables readable by `anon` would expose every share to
  enumeration;
- current preview keys can change when an edit is re-rendered or reset, so they
  are not a stable published visual;
- a long-lived R2 URL is itself a second, uncontrolled bearer link. Revoking the
  page would not revoke a URL already copied out of it.

The public result therefore needs its own identity, version, media map and
security boundary. It is a published deliverable, not another view of canvas
state.

## Decision

### 1. Sharing captures one immutable editorial version

The flow is:

`browser-local draft → sanitized publication snapshot → share-owned media → public link`

Every click on **Create preview link** creates a new `publication_shares` row.
It never updates an earlier version and never points the public page back at the
browser's `localStorage`. Subsequent text, order, crop or Workspace changes are
private until the author deliberately creates another link.

The stored `snapshot` contains only what a recipient may read:

- `schemaVersion`, `kind`, display `name` and the structured Article/Carousel
  content;
- opaque per-publication `publicAssetId` values in editorial order;
- presentation state (fit, aspect, focal point, caption and alt text).

It contains **no** `workspaceId`, `projectId`, `boardId`, source/real `assetId`,
source snapshot, generation brief, model/save tokens, author user id or R2 key.
The web validates the complete discriminated schema; the creation RPC also
recursively refuses those private key names and requires the ordered top-level
`publicAssetIds` list to exactly match the private asset map it inserts.

Workspace rights (`creator`, `credit`, `copyrightNotice`, `usageTerms`) are read
by the DB and frozen beside the snapshot. Editing the account's default credit
later does not rewrite a version already delivered to a client.

`source_draft_id` and `board_id` remain private provenance for the author's
management UI. A board hard-delete sets `board_id` to null rather than deleting
the publication: a deliverable already sent outside the product has a lifecycle
independent of the temporary source scope that made it.

### 2. Media is copied before the version becomes visible

Creation is a two-phase application protocol over one DB state machine:

1. `create_publication_share(...)` validates an owner/editor, a live board and
   project, and 0–20 ordered active assets that still belong to both. It inserts
   a `preparing` share and returns a `copy_plan`.
2. The web copies the exact current medium (edited-medium when one exists) to
   `{workspace_id}/shares/{share_id}/previews/{public_id}.webp`.
3. Only after every R2 copy succeeds does `activate_publication_share(id)` move
   it to `ready`.

Anonymous resolvers accept `ready` only. A crash, partial copy or retry can leave
a private `preparing` row but can never expose a half-built page. Activation is
idempotent; a revoked or expired share cannot be activated again.

The share-owned 1024px WebP freezes the visual used by the Article/Carousel and
strips the public route's dependency on later edit-render keys. It is also the
honest download for a Google Drive asset: Drive originals are not in R2 (ADR
0025), so the recipient sees **Web-size · up to 1024px**, never a medium preview
masquerading under the original filename. For upload/Dropbox assets with a
stored original, `download_quality='original'` references that immutable source
file rather than duplicating it.

**No R2 signature is ever embedded in the page.** Both the pictures a
publication renders and the files it offers are addressed as
`/p/{token}/media/{publicId}` paths; the token is re-validated when the browser
asks for the bytes, and only then does the server exchange a private key for a
five-minute presigned URL. Signing at render time instead would have forced a
choice between two failures: a long TTL that keeps serving photographs after
the author turned the link off, or a short one that expires under an article's
lazily loaded images before the reader scrolls to them.

The preview resolver is deliberately **not** gated on `allow_downloads` and the
download resolver is: rendering a publication is not the same permission as
taking its files away. No signature is stored in Postgres or embedded in the
snapshot. Revocation cannot claw back a presigned URL already issued, so its TTL
stays short; it does stop the next image request cold.

### 3. The URL is a high-entropy capability, stored hash-only

The browser/server creates 32 random bytes and encodes them as a 43-character
base64url token in `/p/{token}`. Before any DB call it SHA-256 hashes that token;
`publication_shares.token_hash` stores only the decoded 32-byte digest.

The raw URL exists in the response/recipient's browser and clipboard, not in the
database. A database read therefore cannot be turned into a list of working
public links, and the existing token cannot be recovered later from its row. The
authoring UI may remember the last raw URL in the same browser as the local
draft; creating a replacement version is the recovery path on another device.

Token digests are unique forever, including after revocation. An old URL can
never become live again because a new share happened to reuse its capability.

### 4. Public access crosses one fenced server integration only

`publication_shares` and `publication_share_assets` have RLS enabled and give
neither `anon` nor `authenticated` any direct table privilege, policy **or
resolver EXECUTE grant**. The Supabase anon key is public by design; granting it
the resolver would let a bearer holder call PostgREST directly and receive the
internal `previewR2Key`/download key that the Next response intentionally
replaces with a short-lived URL. The public page therefore calls the resolvers
from a fenced server integration using `service_role`; no credential or RPC row
is sent to the browser.

Seven deliberately narrow `SECURITY DEFINER` functions are the complete DB API:

- `create_publication_share(...)` — authenticated owner/editor, validation and
  atomic `preparing` share + asset-map insert;
- `activate_publication_share(id)` — the creating editor (while still an
  editor) or a workspace owner;
- `revoke_publication_share(id)` — the same authority; terminally revokes and
  returns the share-owned preview keys for idempotent R2 cleanup;
- `list_publication_shares(board_id)` — editor-only **status** for a board's
  unrevoked versions, carrying `source_draft_id` so the client can group them.
  No token digest, R2 key or snapshot: knowing that a version is live is not the
  same capability as being able to read it. Scoped to the board rather than to
  one draft id precisely because a draft lives in `localStorage` — scoping by
  draft would hide the links whose draft this browser has already lost. Expired
  rows are returned as well, since `status` deliberately stays `ready` past the
  deadline and the caller derives expiry from `expires_at`;
- `resolve_publication_share(token_hash)` — **service-role-only** safe projection
  of a live snapshot plus public media metadata, carrying no R2 key at all;
- `resolve_publication_share_preview(token_hash, public_id)` and
  `resolve_publication_share_asset(token_hash, public_id)` —
  **service-role-only**, one key for that one request. The preview pair is not
  gated on `allow_downloads` and the download pair is.

Invalid hash, unknown token, `preparing`, expired and revoked all return zero
resolver rows. The Next page maps every one to the same 404, so status cannot be
used as an existence oracle. The page is `noindex`, `noarchive`, `no-store` and
`no-referrer`; it renders the structured snapshot as React nodes, never trusted
HTML.

The public recipient is a reader, not a collaborator. They may copy the full
text, download an Article `.md` / Carousel `.txt`, and download each labelled
media file. They cannot edit, comment, regenerate, see source metadata or write
anything back to ArchiveMind.

### 5. Revocation, expiry and deletion fail closed

The author chooses 7 days, 30 days (default) or no automatic expiry. Expiry is a
resolver gate, not a stored presigned-URL deadline. **Turn off link** is terminal:
the same row cannot return to `ready`; making a new version creates a new token.

Any published asset entering Trash, being purged, or being hard-deleted revokes
every share that contains it through a DB trigger. This belongs in the DB rather
than only the photo route because the web, worker and future admin tools can all
change asset state. One missing photograph invalidates the whole version instead
of silently changing its editorial meaning.

Normal user revocation returns copied-preview keys so the route can delete them
from R2 after authority is gone. Asset-triggered revocation and expiration also
make the objects inaccessible immediately, but Postgres cannot delete R2 bytes.
The worker therefore sweeps revoked and expired publications every 6 hours, plus
`preparing` versions abandoned for 24 hours. It validates the exact share-owned
key, deletes R2 first and only then removes the private asset mapping; the parent
row and token digest remain forever so an old capability can never revive.
Until a successful sweep, the copied objects are private and unsigned rather
than working public URLs. Workspace/account erasure must still include the
`shares/` prefix along with originals, previews, edits and exports.

## Consequences

- A creator can send one durable, calm reading view to somebody with no account,
  and that person can copy useful text/files without seeing the ArchiveMind
  editor chrome.
- The public version cannot drift with draft edits, Workspace membership, image
  edits or rights-default changes. A visible change is a new version/link.
- Publication is more storage-expensive than a live view: one WebP copy per used
  image. This is the price of stable pixels and safe edit resets; originals are
  not duplicated.
- Hash-only tokens improve breach safety but are intentionally unrecoverable.
  **Address and status are therefore split:** the URL exists only where its
  author kept it, while `list_publication_shares` makes every unrevoked version
  of a board visible and revocable to any editor. A cleared browser costs you
  the link, not control of it. Re-sending a lost link still means publishing a
  new version; an encrypted-capability vault or a rotate-link workflow would be
  a separate feature, and storing the raw token in this table is not it.
- A public link is still a bearer capability: recipients may forward it or save
  files they already downloaded. Copy and UI state this plainly; ArchiveMind can
  stop future access, not remotely erase somebody else's disk.
- The public viewer introduces one reviewed use of the server-held Supabase
  service role. Its integration module may call only the three resolver RPCs; it
  must never replace those with broad table queries. pgTAP pins that neither
  `anon` nor `authenticated` can invoke them directly.
- Comments, approvals, password-protected links, recipient analytics, custom
  domains, server-backed editable drafts and a combined downloadable package
  remain separate product decisions.
