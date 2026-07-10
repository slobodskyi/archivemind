import type pg from "pg";
import { jobTypeSchema, type JobType } from "@archivemind/shared";

/** One claimed ai_jobs row (the columns handlers need). */
export interface Job {
  id: string;
  workspace_id: string;
  user_id: string | null;
  project_id: string | null;
  type: JobType;
  payload: unknown;
  attempts: number;
  total_items: number | null;
  done_items: number | null;
}

export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_MS = 2 * 60 * 1000; // spec §7: attempts * 2 min
export const STALE_AFTER_MS = 15 * 60 * 1000; // spec §7 reaper cutoff

/** Retry policy (spec §7), pure for unit tests: given the attempts counter
 *  AFTER the failed run, returns the backoff delay — or null when the job
 *  must fail permanently. */
export function retryDelayMs(attempts: number): number | null {
  return attempts < MAX_ATTEMPTS ? attempts * RETRY_BASE_MS : null;
}

/** Atomic claim (spec §7 verbatim): FOR UPDATE SKIP LOCKED so N workers never
 *  double-claim; attempts increments at claim time. */
export async function claimNextJob(pool: pg.Pool, workerId: string): Promise<Job | null> {
  const { rows } = await pool.query(
    `update ai_jobs set status='running', claimed_by=$1, claimed_at=now(),
            started_at=coalesce(started_at, now()), attempts=attempts+1
     where id = (select id from ai_jobs
                 where status='queued' and run_after <= now()
                 order by created_at
                 for update skip locked
                 limit 1)
     returning id, workspace_id, user_id, project_id, type, payload,
               attempts, total_items, done_items`,
    [workerId],
  );
  if (rows.length === 0) return null;
  const row = rows[0] as Job & { type: string };
  return { ...row, type: jobTypeSchema.parse(row.type) };
}

export async function completeJob(pool: pg.Pool, jobId: string): Promise<void> {
  await pool.query(
    `update ai_jobs set status='done', progress=100, finished_at=now(), error=null
     where id=$1`,
    [jobId],
  );
}

/** Spec §7 retry: attempts < 3 → requeue with attempts*2min backoff, else failed. */
export async function failOrRetryJob(pool: pg.Pool, job: Job, message: string): Promise<"retried" | "failed"> {
  const delay = retryDelayMs(job.attempts);
  if (delay === null) {
    await pool.query(
      `update ai_jobs set status='failed', error=$2, finished_at=now() where id=$1`,
      [job.id, message],
    );
    return "failed";
  }
  await pool.query(
    `update ai_jobs set status='queued', error=$2,
            run_after = now() + make_interval(secs => $3::float / 1000),
            claimed_by=null, claimed_at=null
     where id=$1`,
    [job.id, message, delay],
  );
  return "retried";
}

/** Graceful-shutdown release: back to queued NOW; the interrupted run must not
 *  burn a retry attempt (deploys would walk jobs to 'failed'). */
export async function releaseJob(pool: pg.Pool, jobId: string): Promise<void> {
  await pool.query(
    `update ai_jobs set status='queued', run_after=now(),
            attempts=greatest(attempts-1, 0), claimed_by=null, claimed_at=null
     where id=$1 and status='running'`,
    [jobId],
  );
}

/** Long handlers refresh claimed_at so the reaper never steals a live job. */
export async function heartbeat(pool: pg.Pool, jobId: string): Promise<void> {
  await pool.query(`update ai_jobs set claimed_at=now() where id=$1 and status='running'`, [jobId]);
}

export async function updateProgress(
  pool: pg.Pool,
  jobId: string,
  p: { progress: number; label?: string; doneItems?: number; totalItems?: number },
): Promise<void> {
  await pool.query(
    `update ai_jobs set progress=$2,
            progress_label=coalesce($3, progress_label),
            done_items=coalesce($4, done_items),
            total_items=coalesce($5, total_items)
     where id=$1`,
    [jobId, Math.max(0, Math.min(100, Math.round(p.progress))), p.label ?? null, p.doneItems ?? null, p.totalItems ?? null],
  );
}

/** Crash recovery (spec §7): running jobs whose claim went stale → queued. */
export async function reapStaleJobs(pool: pg.Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `update ai_jobs set status='queued', claimed_by=null, claimed_at=null
     where status='running' and claimed_at < now() - make_interval(secs => $1::float / 1000)`,
    [STALE_AFTER_MS],
  );
  return rowCount ?? 0;
}
