# 0008. Store Dropbox originals in R2

Date: 2026-07-06

Status: Accepted

## Context

To avoid CASA verification we import from Dropbox via the **Chooser** (no OAuth). Chooser
**direct links** are re-fetchable for only ~4 h; `files/get_temporary_link` would require
full-Dropbox OAuth — the very scope the Chooser exists to avoid. So Dropbox originals
cannot be re-fetched after the initial window.

## Decision

At ingest, stream the Dropbox bytes **once** (within the 4 h window) and store the
original in **R2**, exactly like a direct upload (`files.r2_key` set,
`origin='dropbox'`). `source_connections` is effectively Drive-only in the MVP.

## Consequences

- Small extra R2 storage for Dropbox originals ($0.015/GB-mo — negligible).
- Dropbox files survive upstream deletion (archive value), unlike Drive-linked files whose
  originals stay in Drive.
- Dropbox **folder** import / full-Dropbox OAuth (production-review clock) → post-MVP.

## What shipped (2026-07-21, #105–#107)

- **Chooser drop-in, zero OAuth.** `apps/web/lib/dropbox-chooser.ts` injects
  `dropins.js` (`id="dropboxjs"` + `data-app-key` — the drop-in reads that attribute at
  eval time) and calls `Dropbox.choose({ linkType: "direct", multiselect: true,
  folderselect: false })`. No `source_connections` row, no tokens, no consent screen:
  the picker runs on the user's own dropbox.com session and returns only what they
  picked. `folderselect` stays false because Dropbox forbids combining it with direct
  links — and, like Drive, folder import is out of MVP anyway.
- **The link is the credential, so it is treated as untrusted input.**
  `isDropboxDirectLink` (packages/shared) is an SSRF gate — https only,
  `dl.dropboxusercontent.com` and subdomains only, no credentials, no port — applied at
  parse time in `POST /api/imports` and again at fetch time in the worker.
- **The 4 h window drives the design.** Links ride in `ai_jobs.payload.dropbox`
  (`{asset_id, link, name}`) because they cannot be re-minted; the worker fetches each
  ONCE into R2 (`{workspace_id}/originals/{uuid}/{filename}`), sets `files.r2_key`, and
  from then on the asset is R2-backed exactly like an upload. Expiry (410/404) surfaces
  as the first-party code `dropbox_link_expired` and heals by re-picking, which is also
  why a re-pick reactivates a `deleted`/`source_missing` asset rather than skipping it.
- **429 handling** honors Dropbox's `Retry-After` (seconds; `0` is the namespace-lock
  flavor) with truncated exponential backoff as the fallback —
  `apps/worker/src/services/dropbox.ts`.
- The Google Drive sibling took the opposite storage decision for the opposite reason —
  see ADR 0025.
