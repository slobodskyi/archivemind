-- Bootstrap fix (issue #5): the first-login flow inserts a workspace and then
-- the creator's owner membership. Two things break under 0001's policies:
--   1. INSERT ... RETURNING id needs SELECT on the new workspace row, but the
--      creator isn't a member yet (workspaces_select = is_member only).
--   2. The memberships self-owner-bootstrap policy's subquery reads workspaces
--      under the caller's RLS, hitting the same wall.
-- Creators must always see workspaces they created.
drop policy workspaces_select on workspaces;
create policy workspaces_select on workspaces for select
  using (is_member(id) or created_by = auth.uid());
