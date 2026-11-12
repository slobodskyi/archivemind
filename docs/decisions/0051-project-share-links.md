# 0051. Project share links: a live, per-link capability for people without an account

Date: 2026-11-03

Status: Accepted

## Context

The only way out of ArchiveMind for somebody without an account was a
publication (ADR 0046): an immutable editorial snapshot of one Workspace draft,
read-only, at most twenty pictures. That answers "read what I wrote". It does not
answer the two requests a photographer actually gets about a *project*: "send me
the photos" and "here are my photos, put them with yours". Both are file transfer,
both are project-sized, and in both the other person has no account and should
not need one.

The codebase constrains the design in specific ways:

- **Originals are big and sometimes absent.** A single PUT carries up to 100 MiB
  (`SINGLE_PUT_MAX_BYTES`). Drive and OneDrive files have no original in R2 at
  all (ADR 0025, 0047). Streaming a 100 MiB original through a Vercel function
  costs function time and bandwidth for every byte; R2 egress costs nothing.
- **The export job already builds ZIPs** (ADR 0035), capped at 500 files and
  2 GiB, at most three in flight per workspace. Its `export-done` broadcast
  reaches every member's open canvas.
- **There is no rate limiter anywhere**, and the Supabase anon key is public.
- **A presigned PUT stays valid for 15 minutes**, and the ordinary upload path
  presigns the *final* original key. For a signed-in editor that is acceptable.
  For an anonymous sender it means the bytes can be swapped after ingest has
  already hashed and previewed them, so the preview shows one picture and the
  download serves another.
- **Ingest dedup revives a trashed duplicate** ("re-adding a soft-deleted photo
  means get it back"). That is right for a member and wrong for a stranger, who
  would be undoing a member's decision to throw the file away.

## Decision

### 1. A project share is a live capability with rights chosen per link

An editor makes a link from the project card's menu (**Share…**) and chooses what
it carries: **download** (browse and take files away), **upload** (a file request:
send files into the project without seeing what is already there), or **both**.

Unlike a publication, a project share is a **live window, not a snapshot**.
Nothing is copied when the link is made. Every request re-resolves the project's
current files, so a file added later appears and a file moved to Trash
disappears with the very next request. A publication must not drift under its
reader because it is an editorial deliverable; a project link exists precisely
to show the project as it is now.

### 2. Token custody: ADR 0046 plus an encrypted copy

The token is 32 random bytes as a 43-character base64url path segment
(`/s/{token}`), looked up by its SHA-256 digest, and the digest stays unique
forever, so an old capability can never come back. `lib/share-token.ts` is the
one implementation for both kinds of link.

In addition, `token_ciphertext` keeps an AES-GCM copy under `TOKEN_ENC_KEY` (the
key and `token-crypto` module Drive and OneDrive tokens already use). This is the
"encrypted-capability vault" ADR 0046 deferred as a separate feature, scoped to
this table. A project link is long-lived and re-sent to different people over
weeks, so an editor must be able to copy it again from any device. The listing
returns the ciphertext only for live links, and only the editor's server route
decrypts it. A database read alone still yields no working link. A link made
without a configured key still works; it just cannot be copied again.

### 3. Every link expires

Expiry is required: 1, 7, 30 or 90 days, defaulting to 7. A live window into a
project must not stay open because a link was forgotten. Extending keeps the
URL. Extending widens exposure, so only the link's creator or a workspace owner
may do it. Turning a link off narrows exposure, so any editor may do it, and it
is terminal. A project has at most 25 live links.

### 4. One liveness rule, in one function

`project_share_by_token()` is the only definition of a live link. A link is live
only if all of these hold:

- it has not been turned off;
- it is before its deadline;
- its project is not in Trash;
- **its creator is still an owner or editor of the workspace.** Removing a
  member must not leave their links serving.

Archiving a project does not stop its links: archiving is organisation, not
access control. Every resolver calls this function, and every failure is zero
rows, which the route turns into the same 404.

### 5. The access surface is ADR 0046's, extended to writes

Both tables have RLS on and no `anon` or `authenticated` privileges.

- **Editors** reach the tables only through SECURITY DEFINER RPCs that check
  `is_editor()` themselves: create, list, extend, rename, revoke, live counts,
  and received files.
- **The public `/s/*` routes** reach them only through service-role-only
  resolvers, called from `lib/integrations/project-shares.server.ts` behind the
  existing ESLint fence on the admin client. Those resolvers are: open, list
  assets, resolve media, reserve, claim and complete uploads, and enqueue and
  read downloads.

The worker reaches two more functions for the sweep. pgTAP `022` pins all of it.

### 6. A recipient sees files, not the archive

The listing is a deliberately small projection: name, kind, size, dimensions,
capture date, whether a preview and an original exist.

- **Never sent:** tags, AI descriptions, facts, captions, colour labels, notes,
  location, member names or other projects.
- **Upload-only links** learn the project name and the workspace byline (the
  credit block publications already print) and nothing else, not even a file
  count.

### 7. Bytes never cross Vercel

A preview or download is addressed as `/s/{token}/media/{assetId}/…`. Each
request re-resolves the token and the asset's membership in the project, then
answers with a **302 to a presigned R2 URL that lives five minutes**. Originals
carry `Content-Disposition: attachment`.

- **Why not stream.** ADR 0046's decision text describes this same exchange; its
  code streams instead, which is fine for twenty 1024px previews. For a
  file-transfer surface it is not: originals reach 100 MiB.
- **What 302 keeps.** No signature is ever embedded in the page, and turning a
  link off stops the next request. What it gives up is a tail of at most five
  minutes on a URL already issued.
- **Every key is checked against the share's workspace prefix in SQL.** A
  project share signs objects for an anonymous reader, so tenant ownership has
  to be structural, not trusted from a row.
- **Drive and OneDrive files** download honestly as their 1024px web preview,
  labelled as such, exactly as in ADR 0046.

### 8. Many files download as one ZIP through the existing export job

`enqueue_project_share_download` keeps only the requested ids that are live in
this project, de-duplicated, in the order asked. It stamps `share_id`, sets no
`user_id` and leaves `ai_jobs.project_id` null (that FK has no delete action).

Guards keep a stranger from crowding out the owner's own exports or looping the
worker:

- at most one ZIP in flight per link;
- at most twenty a day per link;
- at most two link ZIPs in flight per workspace;
- an identical request whose ZIP still exists gets that job back instead of a
  new one.

A link ZIP leaves `captions.csv` out. AI captions and unreviewed facts are the
archive's working material, not the files the link shares.

### 9. The anonymous write path never lets a browser touch a final key

1. **Reserve.** Room for up to 100 files is reserved under a row lock on the
   link, against a per-link quota (2,000 files / 20 GiB, stored per row). Each
   file is still capped at 100 MiB.
2. **Upload to staging.** The browser PUTs to `{ws}/incoming/{reservation}` only.
3. **Claim.** One request atomically claims each reservation, so exactly one
   copier ever finalizes it.
4. **Copy and verify.** The server copies the object to
   `{ws}/originals/{reservation}/{name}`, the ordinary original layout,
   deterministic per reservation. It then checks the size **on the final object**,
   which nobody else can write.
5. **Complete.** One transaction creates the asset, file and project link and
   one `ingest` job carrying `share_id`. A size that differs from the declared
   one is rejected. A retry learns the outcome from reservation status instead of
   repeating the work.

Open reservations count against the quota until the worker's sweep has deleted
their bytes. Otherwise abandoned staging objects would let one link store far
more than its quota.

The sweep is two-phase, because Postgres cannot delete R2 bytes:
`project_share_uploads_to_sweep()` expires stale reservations and hands over the
keys to delete, the worker deletes them, then `mark_project_share_uploads_swept()`
records it. The final key of a completed upload is never handed over: it is the
asset's original.

### 10. A stranger cannot undo a member's decision

- **No revival from Trash.** An ingest job carrying `share_id` never revives a
  trashed duplicate; the new copy is dropped instead.
- **Merges keep the trail.** A merge into a live asset repoints the reservation
  to the surviving asset.
- **No dedup outcome reaches the sender.** The anonymous sender is told only
  that the file was received.

### 11. Provenance

- `assets.received_share_id` and `assets.received_from` (the sender's optional
  name) record where a file came from.
- `added_by` stays null, because no member added it.
- `files.origin` stays `'upload'`: it is an upload into R2, and the source union
  does not grow a member.

### 12. The owner's side

- **Dialog.** **Share…** on a project card opens `ShareProjectDialog`. It
  creates links (mode, expiry, label, a warning that originals travel
  byte-for-byte with their metadata and location) and lists them with status and
  counters. Each link offers Copy, Extend, Turn off and Show on canvas.
- **Card marker.** A project card is marked while it has a live link, so a
  project reachable from outside never looks like one that is not.
- **Drawer.** The drawer says which files arrived through a link, and from
  whom.
- **Toasts.** The owner's canvas still refreshes when a link's ingest finishes,
  so received files appear by themselves. Toasts now fire only for the viewer's
  own jobs; without that, a stranger's ZIP would announce "Your download is
  ready" on the owner's screen.

## Consequences

- Files travel both ways without accounts, and the bytes go browser↔R2 directly.
  Turning a link off takes effect on the next request; a presigned URL already
  issued lives at most five minutes more.
- A live link shows whatever the project holds now, including files added after
  it was sent. The dialog says so, and expiry bounds how long that stays true.
- Originals are shared byte-for-byte, including their camera metadata and GPS.
  The dialog warns; stripping location is a separate feature.
- Any editor can copy any live link of a project, as any editor could make one.
  Rotating `TOKEN_ENC_KEY` leaves existing links working but uncopyable: make a
  new one.
- There is still no rate limiter. Per-link quotas, the per-link and
  per-workspace ZIP caps and 256-bit tokens are what bound abuse. A Vercel WAF
  rule on `/s/*` is an optional operational layer.
- Workspace or account erasure must include `{ws}/incoming/` along with
  originals, previews, edits, exports and `shares/`.
- The ordinary signed-in upload still presigns its final key for 15 minutes. It
  is left as is because its writers are trusted editors; the staging design here
  could be applied to it later.
- Out of scope: password-protected links (planned as a follow-up), email
  notifications when files arrive, comments, and stripping GPS from downloads.

## Amendments

### 2026-11-03 — a link's duplicate merges only inside its own project

§10 as first written let an ordinary dedup merge run for a link upload. A merge
moves the incoming file's project membership onto the surviving asset, wherever
that asset lives in the workspace. So somebody holding the bytes of a photo filed
in another, private project could send it through a link and pull that photo —
with the member's title, corrected date and edits — into the shared project,
where every link holder and the owner's canvas see it. On a link that can also
download, the listing answered "is this exact file in the workspace?" too:
§10's "no dedup outcome reaches the sender" held only for upload-only links.

An ingest carrying `share_id` now merges only into an **active asset that is
already a member of the link's project**. A duplicate of anything else — a file
filed only in other projects, or a trashed or purged one — **drops** the
sender's copy: its file row, asset and bytes go, no `project_assets` row is
written and the survivor is not touched. The rule applies to every link with
upload rights, not only those that can download.

The reservation is still repointed to the survivor, so the delivery is recorded:
it counts in the link's "files received", while `list_project_share_received`
(project members only) does not show a file the project does not hold. The
sender is told "received" either way. No schema change.

### 2026-11-12 — scopes and opt-in details (ADR 0053)

Read ADR 0053 before relying on §1, §4, §6, §10 or §12 above:

- **§1** — a link now has a scope inside its project: the whole project (as
  here), one Workspace, or a fixed list of files. A list cannot receive files.
- **§4** — liveness is now the function `project_share_is_live()`, which every
  resolver and both editor listings call, and it adds one clause: a Workspace
  link lives only while its Workspace is out of Trash. What a link carries is
  likewise one function, `project_share_scope_assets()`.
- **§6** — the projection is still the default, but each link may turn on
  Workspaces (as a filter), colour labels, tags and one caption. Off means null
  from SQL, and a filter on a detail that is off is refused. Facts, location,
  notes and member names still never cross.
- **§10** — a file sent through a Workspace link also joins that Workspace; the
  dedup rule above needs no change for it.
- **§12** — `ShareProjectDialog` becomes one Share dialog opened from four
  places, starting from the selection, else the open Workspace, else the
  project.

