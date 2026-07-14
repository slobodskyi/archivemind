-- Homepage archive/trash (issue: sidebar Archived + Trash surfaces): soft
-- state on projects so a project can be tucked away or soft-deleted without
-- losing its assets. deleted_at drives the 30-day trash grace period (the
-- sweep that hard-deletes past that window is a future scheduled job, not
-- part of this migration).
alter table projects
  add column archived_at timestamptz,
  add column deleted_at timestamptz;
