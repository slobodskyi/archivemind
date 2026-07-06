# 0011. Asset ≠ File — assets are the canonical entity

Date: 2026-07-06

Status: Accepted

## Context

A single shot / document can exist as several byte representations (RAW + JPEG, an
upload plus its Dropbox copy, alternate exports). A file-centric schema pinned AI outputs,
curation, and dedup to one physical file and re-did work whenever the same shot arrived
again.

## Decision

Split the model. `assets` is the canonical entity (`kind`, `title`, `status`,
`ai_processed_at`); `files` are its physical representations (`asset_id` FK, `origin`,
`r2_key`, `content_hash`). Previews, EXIF, tags, captions, facts, embeddings, and project
membership all reference **`asset_id`** — they describe the shot, not a byte blob. Dedup is
sha256 per file with a unique `(workspace_id, content_hash)` index; on conflict the incoming
file **attaches to the existing asset** instead of creating a new one. The frontend seam and
API rename `photo`/`file` → `asset` (`getAssets`, `/api/assets`).

## Consequences

- One shot = one asset regardless of how many representations arrive; AI runs once.
- `files` carries a denormalized `workspace_id` (RLS + the dedup index).
- Asset-child tables authorize via their asset's workspace (helper `is_member_of_asset`).
- MVP UI treats most assets as single-representation; multi-representation management UI is
  post-MVP (spec §13).
- Supersedes the file-centric §4 in TECH_SPEC ≤ v1.1 (now v1.2).
