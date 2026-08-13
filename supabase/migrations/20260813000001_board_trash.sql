-- Workspace trash — ADR 0044 as amended.
--
-- Deleting a Workspace was an immediate hard DELETE: the row went, board_assets
-- cascaded, and every note, folder and artboard made inside it had its board_id
-- nulled. None of that is recoverable, and the × that did it sits on the chip
-- you click to OPEN the workspace — one slip away from the most destructive
-- control in the header. So the delete asks first, and what it does is soft.
--
-- Same shape as the project trash (20260713000001 + 20260714000001): a
-- deleted_at column, reads filtered on it, and a sweep that hard-deletes past
-- the window. Reused rather than invented so "in the Trash" means one thing
-- across projects, photos and now workspaces — and so the restore path is the
-- same PATCH { deleted: false } the project cards already use.
--
-- Why this makes restore WHOLE where the old delete could not: a soft delete
-- touches nothing else. board_assets keeps its rows, and the notes and folders
-- keep pointing at the board, so bringing it back brings back the arrangement,
-- not just the name. The FK side-effects only ever run at the sweep.

alter table boards add column deleted_at timestamptz;

-- The header reads a project's live chips on every canvas load. Partial, because
-- the query is (init.sql's convention, cf. projects_ws_active_idx).
create index boards_project_active_idx on boards (project_id) where deleted_at is null;

comment on column boards.deleted_at is
  'Moved to Trash at (ADR 0044). Membership, notes and folders are left intact so '
  'a restore is whole; hard-deleted after 30 days by sweep_trashed_boards().';

-- Hard-delete workspaces whose grace period has expired. Only here do the FK
-- side-effects run: board_assets cascades, and canvas_groups.board_id /
-- canvas_annotations.board_id go null — the notes and folders survive as the
-- project canvas's, which is what a null board_id already means. Photos are
-- never touched; a board is a curated subset, not a container of bytes.
--
-- security INVOKER on purpose, exactly like sweep_trashed_projects: the worker
-- connects as `postgres` and bypasses RLS so it sweeps every tenant, while an
-- authenticated caller stays scoped by boards_delete (is_editor) to their own
-- workspace. Definer here would let any logged-in user purge another tenant's
-- trashed workspaces.
create function sweep_trashed_boards(retention interval default interval '30 days')
returns integer
language plpgsql
set search_path = public
as $$
declare
  removed integer;
begin
  delete from boards
   where deleted_at is not null
     and deleted_at < now() - retention;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function sweep_trashed_boards(interval) is
  'Hard-deletes trashed Workspaces past the retention window (default 30 days, '
  'matching the Trash copy in TrashPanel). Scheduled by apps/worker/src/retention.ts; '
  'photos, notes and folders all survive. See ADR 0044.';
