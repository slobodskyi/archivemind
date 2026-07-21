# 0025. Drive import: popup code flow, encrypted refresh tokens, originals stay in Drive

Date: 2026-07-21

Status: Accepted

## Context

Phase 6 (#23) connects Google Drive and imports the user's files. The data model
was fixed long before this ADR: `source_connections` with encrypted token columns
has been live since migration 0001 (column-revoked from `anon`/`authenticated`,
pgTAP-covered), `files.r2_key` is *null* for Drive-linked files, and TECH_SPEC §6
says Drive originals are **never copied to R2** — the worker streams bytes at
processing time (ADR 0008 records the deliberate contrast with Dropbox). That
model has a hard implication: Drive bytes are needed not just during the import
but at every later re-analyze/re-process/export, so the server needs **durable**
access — a refresh token — not whatever short-lived token happens to exist while
the user is looking at the picker.

The scope is `drive.file` (per-file grants via the Google Picker), chosen in the
spec explicitly to avoid CASA verification. Google login (#89) lives on a
**separate** OAuth client in the same Cloud project so that Drive consent never
touches the sign-in flow (PLAN Phase 0.3).

A day-1 spike (2026-07-21, our real Cloud project, popup code flow against
`oauth2.googleapis.com/token` with `redirect_uri=postmessage`, then Drive v3
calls with the resulting tokens) pinned down the facts this design leans on:

- **Folder grants do not cascade.** Picking a folder under `drive.file` makes
  the folder *object* visible (`files.get` 200) while `files.list` on its
  children returns zero rows. Whole-tree import is impossible under this scope,
  by design — that is a product constraint, not a bug to fix.
- **Per-file grants are keyed to the Cloud project and work from the backend.**
  Multiselected files download fine with a server-minted access token. The same
  files picked **without** `setAppId(project number)` return 404 to the backend —
  so a missing/wrong `setAppId` looks exactly like "the grant is broken".
- **`alt=media` returns the original bytes.** Our computed md5 of the downloaded
  bytes equals Drive's own `md5Checksum` on every file — no transcoding, safe
  for sha256 dedup and RAW/HEIC fidelity.
- **The code exchange yields a refresh token** (`access_type` offline is implied
  by the code flow), and `imageMediaMetadata` (EXIF incl. capture time) comes
  back on a 5-unit metadata read without downloading the file.

Two alternatives were considered and rejected:

- **Client-only tokens** (GIS `initTokenClient`, ship the ~1 h access token to
  our API): dies on the storage model above — after the hour, every Drive-linked
  file in the archive would be unreadable until the user shows up and re-consents.
  It would also put a live bearer token inside `ai_jobs.payload`, and the
  Broadcast trigger ships whole `ai_jobs` rows to every workspace member's
  browser. Google's own docs mark implicit-flow tokens as browser-only.
- **Piggybacking Supabase `signInWithOAuth` extra scopes**: technically possible
  (`provider_refresh_token` appears once and Supabase does not store or refresh
  it), but it re-merges the OAuth clients Phase 0.3 deliberately separated,
  shows a Drive consent screen to every Google-login user including those who
  never import, covers no email+password user, and complicates the hardened
  `/auth/callback` (ADR 0021) for no gain.

## Decision

**Server-side authorization-code flow, delivered through a popup, with refresh
tokens encrypted at rest. No public callback route exists.**

- The browser uses GIS **`initCodeClient` with `ux_mode: 'popup'`**. The
  authorization code arrives in a JS callback and is POSTed to an
  **authenticated** route handler, which exchanges it with
  `redirect_uri: 'postmessage'` plus the server-held client secret. Nothing is
  added to `proxy.ts` `PUBLIC_PATHS`; `lib/safe-redirect.ts` is not involved
  because no redirect-based flow exists.
- Tokens are encrypted with **AES-256-GCM** under `TOKEN_ENC_KEY` (32 bytes,
  present only in Vercel and Railway env) and stored in the existing
  `source_connections` token columns. The encrypt/decrypt pair is implemented
  **once, in `packages/shared`** — both consumers (web route, worker) are
  server-side Node; two hand-maintained copies of a wire format is how tokens
  silently become undecryptable.
- The Picker itself uses a **separate, browser-minted** short-lived token
  (`initTokenClient`, `prompt: ''` — the grant already exists, so no second
  consent). Stored tokens never travel to the browser; the browser's token is
  never stored. `setAppId` gets the Cloud **project number** — the spike's
  negative control shows the 404 you get otherwise.
- The import itself is **not a new job type**: the web route creates
  `assets`/`files` rows (`origin='gdrive'`, `r2_key` null, `source_file_id`,
  `source_connection_id`) and enqueues a normal `ingest` job. The worker gains a
  byte-source seam where it currently skips `r2_key IS NULL` rows
  (`handlers/ingest.ts` — the comment there has promised this since Phase 1):
  stream `files.get?alt=media` into the existing sha256/EXIF/preview pipeline.
  No migration, no `job_type` enum change.
- A dedicated OAuth client ("drive import") holds the `drive.file` scope; the
  login client stays scope-clean. Both live in the same Cloud project as the
  Picker API key, because the per-file grant is keyed to the project number.
- **ADR 0021 extends to this surface**: every provider/network failure that can
  reach `ai_jobs.error` (Broadcast ships it to every member's browser, and the
  UI renders it verbatim) or an API response is mapped to a first-party code
  (`drive_connection_revoked`, `drive_rate_limited`, `drive_admin_blocked`, …)
  before it leaves the worker or route. Google's error text is logged
  worker-side only, with tokens redacted.

## Consequences

Easier: zero `supabase/**` changes (db-tests fast-skips the whole feature); no
new public route to harden; no CASA and no verification gate (`drive.file` is
non-sensitive — with the consent screen published to Production there is no
"unverified app" interstitial, no 100-user cap, and refresh tokens outlive the
7-day Testing TTL); import progress UI comes free through the existing `ingest`
Broadcast channel.

Accepted costs, each deliberate:

- **No folder-tree import.** The user picks files (multiselect, LIST mode —
  thumbnails are unavailable to the Picker under `drive.file`). If real users
  with 10k+ corpora reject that UX, the V2 answer is `drive.readonly` + annual
  CASA (~$675/yr, weeks of process) — a priced, documented trigger, not a bug.
- **Connect does not work on Vercel previews.** Google OAuth JS origins accept
  no wildcards, so only `www.archivemind.media` and `localhost:3000` are
  registered. Test the flow locally or on prod; a specific preview origin can be
  added by hand when genuinely needed.
- The connect route needs the **service-role** client (token columns are
  column-revoked from `authenticated` — that is the point), so `apps/web` gains
  `SUPABASE_SERVICE_ROLE_KEY`. All token access is fenced into one server-only
  module, ESLint-guarded, so "just import the admin client" never spreads.
- A connection is **personal** (`user_id`), while the workspace is shared:
  `POST /api/imports` must verify `connection.user_id === caller`, not just
  workspace membership — otherwise any editor could exercise another member's
  refresh token against arbitrary file ids.
- `source_connections` has no unique index on `(workspace_id, user_id,
  provider)`, so connect is select-then-write, not upsert; the index goes into a
  `schema:` issue for the migrations owner rather than blocking this feature.
- Losing `TOKEN_ENC_KEY` invalidates every stored connection at once. The
  recovery is one re-consent popup per user — annoying, not catastrophic — and
  the ciphertext format carries a version prefix so the key can be rotated
  deliberately.

Dropbox (#24) is untouched by all of this: it stays on the Chooser path of
ADR 0008 (no OAuth, originals fetched once into R2).
