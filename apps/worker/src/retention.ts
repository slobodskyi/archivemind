import type pg from "pg";

/** Retention sweeps — periodic maintenance that isn't queue work, so it lives
 *  here rather than in queue.ts. Scheduled from index.ts alongside the reaper. */

/** Hard-delete trashed projects past their grace period (migration
 *  20260714000001). The window lives in the SQL function's default so there is
 *  one source of truth; assets are workspace-global and survive. Returns the
 *  number of projects removed. */
export async function sweepTrashedProjects(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ removed: number }>(
    "select sweep_trashed_projects() as removed",
  );
  return rows[0]?.removed ?? 0;
}

/** Enqueue 'purge' jobs for trashed ASSETS past their grace period (migration
 *  20260723000001, ADR 0033). Same shape as the project sweep — the 30-day
 *  window lives in the SQL default — but this one only enqueues: the purge
 *  handler does the R2 + derivative erasure so the sweep stays a fast DB call.
 *  Returns the number of assets enqueued. */
export async function sweepDeletedAssets(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ enqueued: number }>(
    "select sweep_deleted_assets() as enqueued",
  );
  return rows[0]?.enqueued ?? 0;
}
