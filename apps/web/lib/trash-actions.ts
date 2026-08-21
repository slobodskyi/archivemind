import type { SupabaseClient } from "@supabase/supabase-js";
import { purgeJobPayloadSchema, type TrashItemKind, type TrashTarget } from "@archivemind/shared";

/** Restore / permanent-delete for a MIXED Trash selection (ADR 0049).
 *
 *  Both verbs are per-kind by nature — a photo comes back by flipping a status
 *  enum, a project by clearing a timestamp, and a photo is *purged* by a worker
 *  job rather than a DELETE — so the fan-out lives in one module that the two
 *  routes share. Everything here runs on the caller's RLS-scoped client: an id
 *  from another workspace matches no row, which is why each arm returns what it
 *  actually changed rather than what it was asked to change.
 *
 *  Every statement is guarded on the row still being IN the trash. That is what
 *  makes a stray id a no-op instead of data loss: an active project can never be
 *  hard-deleted through here, and an already-purged asset can never be revived. */

/** The table each kind lives in, and the column that says it is in the Trash.
 *  Assets are absent on purpose — their state is an enum, not a timestamp, and
 *  their purge is a job. */
const TIMESTAMPED: Partial<Record<TrashItemKind, string>> = {
  project: "projects",
  workspace: "boards",
  draft: "content_drafts",
};

function idsOf(items: TrashTarget[], kind: TrashItemKind): string[] {
  return items.filter((item) => item.kind === kind).map((item) => item.id);
}

export async function restoreTrashTargets(
  supabase: SupabaseClient,
  items: TrashTarget[],
): Promise<TrashTarget[]> {
  const done: TrashTarget[] = [];

  const assetIds = idsOf(items, "asset");
  if (assetIds.length > 0) {
    // Purged tombstones stay put: their bytes are gone, so "restoring" one
    // would put a broken tile back on the canvas (ADR 0033).
    const { data } = await supabase
      .from("assets")
      .update({ status: "active" })
      .in("id", assetIds)
      .eq("status", "deleted")
      .is("purged_at", null)
      .select("id");
    for (const row of data ?? []) done.push({ kind: "asset", id: row.id as string });
  }

  for (const [kind, table] of Object.entries(TIMESTAMPED) as [TrashItemKind, string][]) {
    const ids = idsOf(items, kind);
    if (ids.length === 0) continue;
    const { data } = await supabase
      .from(table)
      .update({ deleted_at: null })
      .in("id", ids)
      .not("deleted_at", "is", null)
      .select("id");
    for (const row of data ?? []) done.push({ kind, id: row.id as string });
  }

  return done;
}

/** The inverse of restoreTrashTargets: back into the Trash, soft. Only rows
 *  that are currently OUT of it move, so a double-tapped Undo is a no-op rather
 *  than a second delete of something already deleted. */
export async function trashTargets(
  supabase: SupabaseClient,
  items: TrashTarget[],
): Promise<TrashTarget[]> {
  const done: TrashTarget[] = [];

  const assetIds = idsOf(items, "asset");
  if (assetIds.length > 0) {
    // The DB trigger stamps deleted_at/deleted_by on the transition, so the
    // route writes the status and nothing else (ADR 0033/0049).
    const { data } = await supabase
      .from("assets")
      .update({ status: "deleted" })
      .in("id", assetIds)
      .eq("status", "active")
      .select("id");
    for (const row of data ?? []) done.push({ kind: "asset", id: row.id as string });
  }

  for (const [kind, table] of Object.entries(TIMESTAMPED) as [TrashItemKind, string][]) {
    const ids = idsOf(items, kind);
    if (ids.length === 0) continue;
    const { data } = await supabase
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids)
      .is("deleted_at", null)
      .select("id");
    for (const row of data ?? []) done.push({ kind, id: row.id as string });
  }

  return done;
}

export async function purgeTrashTargets(
  supabase: SupabaseClient,
  items: TrashTarget[],
  userId: string,
): Promise<TrashTarget[]> {
  const done: TrashTarget[] = [];

  const assetIds = idsOf(items, "asset");
  if (assetIds.length > 0) {
    const { data: rows } = await supabase
      .from("assets")
      .select("id, workspace_id")
      .in("id", assetIds)
      .eq("status", "deleted")
      .is("purged_at", null);

    // A caller who belongs to several workspaces can hold trash in each; one
    // purge job per workspace, mirroring the sweep's own grouping.
    const byWorkspace = new Map<string, string[]>();
    for (const row of rows ?? []) {
      const ws = row.workspace_id as string;
      byWorkspace.set(ws, [...(byWorkspace.get(ws) ?? []), row.id as string]);
    }
    for (const [workspaceId, ids] of byWorkspace) {
      const { error } = await supabase.from("ai_jobs").insert({
        workspace_id: workspaceId,
        user_id: userId,
        type: "purge",
        payload: purgeJobPayloadSchema.parse({ asset_ids: ids }),
        total_items: ids.length,
        done_items: 0,
      });
      // An enqueue that fails leaves those ids out of `done`, so the UI keeps
      // showing them — which is the honest outcome: nothing was erased.
      if (!error) for (const id of ids) done.push({ kind: "asset", id });
    }
  }

  for (const [kind, table] of Object.entries(TIMESTAMPED) as [TrashItemKind, string][]) {
    const ids = idsOf(items, kind);
    if (ids.length === 0) continue;
    // The `deleted_at is not null` guard is the whole safety story for the hard
    // delete: only something already in the Trash can be removed for good.
    const { data } = await supabase
      .from(table)
      .delete()
      .in("id", ids)
      .not("deleted_at", "is", null)
      .select("id");
    for (const row of data ?? []) done.push({ kind, id: row.id as string });
  }

  return done;
}
