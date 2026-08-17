-- OneDrive, part 2 of 2: the columns that carry a driveItem's identity — ADR 0047.
-- Safe to reference 'onedrive' here; 20260817000001 committed the enum values.

-- A OneDrive item id is unique only WITHIN its drive, so (driveId, itemId) is
-- the composite identity where Drive and Dropbox each had a single opaque id.
-- files.source_file_id already holds the item id; this holds the other half.
--
-- Deliberately named generically rather than `onedrive_drive_id`: Google shared
-- drives are the same shape (a file id scoped to a drive), so when that lands it
-- fills this column instead of adding a third one.
alter table files add column if not exists source_drive_id text;

comment on column files.source_drive_id is
  'Provider drive scope for source_file_id — OneDrive driveId (ADR 0047). Null for '
  'upload/dropbox and for gdrive''s My Drive, whose file ids are already unique.';

-- Provenance and re-fetch lookups: "does this workspace already hold this
-- driveItem for this connection?". Column order is the access pattern — the
-- first three are equality (workspace, connection, drive) and source_file_id
-- takes the IN (...) of a picked batch, so all four are usable in one scan.
-- Partial for the same reason files_dedup_idx is: rows with no source id are
-- uploads, and they are the majority.
create index if not exists files_source_lookup_idx
  on files (workspace_id, source_connection_id, source_drive_id, source_file_id)
  where source_file_id is not null;

-- Per-connection provider detail that has no column of its own and does not
-- deserve one each: driveId (the user's own drive, resolved once at connect),
-- accountType ('personal' | 'business'), tenantId, homeAccountId.
--
-- jsonb and not columns because none of it is ever queried — it is read back
-- whole when the worker or the browser needs to address the drive, and the set
-- differs per provider. Tokens stay in the existing access_token_enc /
-- refresh_token_enc columns: nothing secret goes in here, precisely because
-- this column is member-readable while those two are not.
alter table source_connections
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

-- REQUIRED, not optional tidiness. source_connections is the one table in the
-- schema with COLUMN-level grants: init.sql:365 revokes table-wide select from
-- authenticated and re-grants an explicit column list, so that the token
-- ciphertexts stay unreadable even to a member whose RLS lets them see the row.
-- A column added after that revoke is therefore invisible by default — any
-- select naming it fails with `permission denied for table source_connections`,
-- and (worse) a `select *` silently starts failing for every caller. Grant it.
grant select (provider_metadata) on source_connections to authenticated;

comment on column source_connections.provider_metadata is
  'Non-secret, non-queried provider detail (ADR 0047). OneDrive: driveId, '
  'accountType, tenantId. NEVER tokens — this column is member-readable by '
  'explicit column grant, unlike access_token_enc / refresh_token_enc.';
