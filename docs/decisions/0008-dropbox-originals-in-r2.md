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

Stub — expand at Phase 6 (cloud imports).
