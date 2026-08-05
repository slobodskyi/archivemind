-- Manual Metadata/EXIF corrections (PR #184 shipped the drawer's editor with no
-- backend behind it — the pen toggle wrote to component state and threw it away
-- on the next photo).
--
-- Why the correction lands in asset_exif's OWN columns rather than an overlay
-- table: every consumer already reads them. taken_at places the photo on the
-- Timeline and answers the search RPC's date filters; camera/iso/aperture are
-- three of that RPC's EXIF filters (20260722000004); gps_lat/lon put the marker
-- on the Map (ADR 0027); the captions CSV exports the lot. An overlay would have
-- to be merged in by each of those readers — including two SQL functions — and a
-- reader that forgot would quietly show the wrong value while the UI insisted it
-- had been fixed. Writing in place is also the house pattern for "the worker
-- produced a value, a human corrected it": captions do exactly this with
-- is_edited (init.sql:438).
--
-- What is NOT destroyed: `original_values` snapshots each column the first time
-- a human overwrites it, so Revert restores exactly what ingest extracted.
--
-- The obvious alternative was to revert from `raw`, which already holds the full
-- original dump — but `raw` is the extractor's own vocabulary (exifr's keys, or
-- exiftool's on the HEIC path, #113), not ours. Only the worker's extractExif
-- knows how to turn it back into these columns, and the web app has no business
-- growing a second copy of that mapping that could drift from it. A snapshot of
-- the values we actually stored needs no interpretation to restore.

alter table asset_exif
  add column edited_fields text[] not null default '{}',
  add column original_values jsonb not null default '{}';

comment on column asset_exif.edited_fields is
  'Column names a human has corrected by hand. Two readers depend on it: the drawer marks those fields as edited and offers Revert, and the ingest handler MUST NOT overwrite a listed column on a re-ingest — otherwise a dedup revival or the #113 HEIC re-extract silently discards the correction.';

comment on column asset_exif.original_values is
  'What ingest extracted, captured per column the FIRST time a human overwrites it, keyed by column name — the values Revert restores. Only ever added to while an edit stands; cleared wholesale on Revert. Never re-snapshotted on a second edit of the same column, or the "original" would drift into being the previous correction.';

-- ── row gate ─────────────────────────────────────────────────────────────────
-- asset_exif has been worker-written (service role) since init.sql:391 and has
-- only ever had a SELECT policy, so these two verbs were previously impossible
-- from a browser, not merely ungranted. Editors of the asset get them now; the
-- INSERT policy matters because an asset whose file carried no EXIF at all has
-- no row to update (ingest only inserts when extraction returned something,
-- ingest.ts:383), and "add the camera by hand" has to work there most of all.
create policy asset_exif_insert on asset_exif for insert
  with check (is_editor_of_asset(asset_id));

create policy asset_exif_update on asset_exif for update
  using (is_editor_of_asset(asset_id)) with check (is_editor_of_asset(asset_id));

-- ── column gate ──────────────────────────────────────────────────────────────
-- Same revoke-then-column-grant narrowing as topic_clusters (20260727000003) and
-- the source_connections token columns (init.sql:365-368), and for the same
-- reason: a column ACL raises 42501 instead of filtering, so an attempt to write
-- a column outside this list is an error the caller sees rather than a silent
-- no-op. Excluded on purpose:
--   raw           — the extractor's own original dump. Nothing reads it today,
--                   and a client that could rewrite it would destroy the only
--                   record of what the file itself claimed
--   focal_length  — not in the drawer's editor; no UI can produce it
--   asset_id      — grantable on INSERT (the row must name its asset) but never
--                   on UPDATE, so a correction cannot be moved onto another
--                   asset, including one in someone else's workspace
--
-- `original_values` IS granted, unlike topic_clusters.centroid, because its
-- blast radius stops at the caller's own photo: forging it makes their own
-- Revert restore a wrong number and touches nobody else. The route decides what
-- goes in it — the grant exists only because that route runs as the caller.
revoke insert, update on table asset_exif from authenticated;

grant insert (asset_id, taken_at, camera_make, camera_model, lens,
              gps_lat, gps_lon, gps_label, location_source,
              iso, aperture, shutter, edited_fields, original_values)
  on table asset_exif to authenticated;

grant update (taken_at, camera_make, camera_model, lens,
              gps_lat, gps_lon, gps_label, location_source,
              iso, aperture, shutter, edited_fields, original_values)
  on table asset_exif to authenticated;
