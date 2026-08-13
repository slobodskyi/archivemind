import { EXPORT_RETENTION_DAYS } from "@archivemind/shared";
import type pg from "pg";
import { deleteObject } from "./services/r2";

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

/** Hard-delete trashed WORKSPACES past their grace period (migration
 *  20260813000001, ADR 0044). Same shape and same 30-day default as the project
 *  sweep, and like it this never touches R2: a workspace is a curated subset of
 *  a project's files. Only here do the FK side-effects run — membership rows
 *  cascade and the notes and folders made inside fall back to the project canvas
 *  with board_id null. Returns the number of workspaces removed. */
export async function sweepTrashedBoards(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ removed: number }>(
    "select sweep_trashed_boards() as removed",
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

/** Delete the R2 objects behind expired exports (ADR 0035 Amendments).
 *
 *  Nothing used to remove these, ever: the two sweeps above touch R2 not at all,
 *  purge.ts collects keys only from files/asset_previews/asset_edits, and there
 *  is no bucket lifecycle rule in the repo. Because the key derives from the JOB
 *  id, every re-export of the same artboard minted another object — so ten
 *  iterations left ten PDFs, all unreachable once the job id was forgotten.
 *  TECH_SPEC §8.5 said "(presigned GET, cleanup later)"; this is later.
 *
 *  The `ai_jobs` row survives as the record of the export; only the artifact and
 *  its key go, so `GET /api/exports` stops offering a download for bytes that no
 *  longer exist. Deletes run one at a time and clear the key individually: a
 *  failure mid-way leaves the rest for the next sweep rather than orphaning the
 *  objects whose keys it had already dropped. */
export async function sweepExpiredExports(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ id: string; result_key: string }>(
    `select id, payload->>'result_key' as result_key
       from ai_jobs
      where type = 'export'
        and payload ? 'result_key'
        and coalesce(finished_at, created_at) < now() - ($1 || ' days')::interval
      limit 500`,
    [String(EXPORT_RETENTION_DAYS)],
  );

  let removed = 0;
  for (const row of rows) {
    if (!row.result_key) continue;
    await deleteObject(row.result_key); // idempotent: deleting a missing key succeeds
    await pool.query(`update ai_jobs set payload = payload - 'result_key' where id = $1`, [row.id]);
    removed += 1;
  }
  return removed;
}
