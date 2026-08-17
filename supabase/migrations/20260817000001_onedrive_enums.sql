-- OneDrive, part 1 of 2: the enum values ONLY — ADR 0047.
--
-- This file exists apart from 20260817000002 for one reason, and it is not
-- tidiness. Postgres will not let a newly added enum value be USED in the same
-- transaction that added it, and the Supabase CLI wraps each migration file in
-- a transaction. Put the `alter type` beside a statement that references
-- 'onedrive' and the migration fails with
--   unsafe use of new value "onedrive" of enum type source_provider
-- So: values here, everything that reads them in the next file. Do not merge
-- these two, and do not add a column default or a check constraint mentioning
-- 'onedrive' below.
--
-- Both enums are extended because a OneDrive import writes both sides of the
-- same fact: source_connections.provider records WHOSE account the grant is,
-- files.origin records where a given byte blob came from. gdrive and dropbox
-- already appear in both (init.sql:39, init.sql:57).

alter type source_provider add value if not exists 'onedrive';
alter type file_origin     add value if not exists 'onedrive';
