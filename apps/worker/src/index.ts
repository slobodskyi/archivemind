import os from "node:os";
import { createPool } from "./db";
import { handlers } from "./handlers/index";
import {
  claimNextJob,
  completeJob,
  failOrRetryJob,
  heartbeat,
  reapStaleJobs,
  releaseJob,
  updateProgress,
  type Job,
} from "./queue";
import { backfillGeoLabels } from "./geo-backfill";
import { sweepTrashedProjects } from "./retention";

/** Poll loop + graceful shutdown (TECH_SPEC §7).
 *  - idle: poll every POLL_MS (default 2 s)
 *  - reaper: every 5 min requeue stale 'running' jobs (crash recovery)
 *  - heartbeat: refresh claimed_at every 60 s while a job runs
 *  - sweeper: on start, then every 6 h, hard-delete expired trashed projects
 *  - geo backfill: on start, then every 6 h, label pre-ADR-0026 coordinates
 *  - SIGTERM/SIGINT: stop claiming; release the in-flight job back to queued */

const POLL_MS = Number(process.env.POLL_MS ?? 2000);
const REAPER_EVERY_MS = 5 * 60 * 1000;
const HEARTBEAT_EVERY_MS = 60 * 1000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const workerId = process.env.WORKER_ID ?? `${os.hostname()}:${process.pid}`;

const log = (msg: string) => console.log(`[worker ${workerId}] ${msg}`);

let shuttingDown = false;
let currentJob: Job | null = null;

async function processJob(pool: ReturnType<typeof createPool>, job: Job): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    const outcome = await failOrRetryJob(pool, job, `no handler for job type '${job.type}'`);
    log(`job ${job.id} (${job.type}): no handler → ${outcome}`);
    return;
  }
  const beat = setInterval(() => {
    heartbeat(pool, job.id).catch((e: unknown) => log(`heartbeat failed: ${String(e)}`));
  }, HEARTBEAT_EVERY_MS);
  try {
    await handler({
      pool,
      job,
      progress: (progress, label, doneItems, totalItems) =>
        updateProgress(pool, job.id, { progress, label, doneItems, totalItems }),
    });
    await completeJob(pool, job.id);
    log(`job ${job.id} (${job.type}): done`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const outcome = await failOrRetryJob(pool, job, message);
    log(`job ${job.id} (${job.type}): error "${message}" → ${outcome}`);
  } finally {
    clearInterval(beat);
  }
}

async function main(): Promise<void> {
  const pool = createPool();
  log(`started (poll ${POLL_MS}ms, pool max ${process.env.WORKER_POOL_MAX ?? 3})`);

  const reaper = setInterval(() => {
    reapStaleJobs(pool)
      .then((n) => n > 0 && log(`reaper requeued ${n} stale job(s)`))
      .catch((e: unknown) => log(`reaper failed: ${String(e)}`));
  }, REAPER_EVERY_MS);

  const runSweep = () =>
    sweepTrashedProjects(pool)
      .then((n) => n > 0 && log(`sweeper removed ${n} expired trashed project(s)`))
      .catch((e: unknown) => log(`sweeper failed: ${String(e)}`));
  // Once on boot as well as on the timer: redeploys can be more frequent than
  // SWEEP_EVERY_MS, and a timer-only sweep would then never fire.
  void runSweep();
  const sweeper = setInterval(() => void runSweep(), SWEEP_EVERY_MS);

  // Same cadence for the geo backfill (ADR 0026): assets ingested before
  // reverse geocoding existed have coordinates but no place label. It settles
  // to a no-op once every row is labelled.
  const runGeoBackfill = () =>
    backfillGeoLabels(pool)
      .then((n) => n > 0 && log(`geo backfill labelled ${n} asset(s)`))
      .catch((e: unknown) => log(`geo backfill failed: ${String(e)}`));
  void runGeoBackfill();
  const geoBackfiller = setInterval(() => void runGeoBackfill(), SWEEP_EVERY_MS);

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} — finishing up`);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  while (!shuttingDown) {
    let job: Job | null = null;
    try {
      job = await claimNextJob(pool, workerId);
    } catch (e) {
      log(`claim failed: ${String(e)} — retrying in ${POLL_MS}ms`);
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    currentJob = job;
    log(`claimed job ${job.id} (${job.type}, attempt ${job.attempts})`);
    await processJob(pool, job);
    currentJob = null;
  }

  clearInterval(reaper);
  clearInterval(sweeper);
  clearInterval(geoBackfiller);
  if (currentJob) {
    await releaseJob(pool, currentJob.id);
    log(`released in-flight job ${currentJob.id} back to queue`);
  }
  await import("./services/raw").then((m) => m.closeExifTool()).catch(() => {});
  await pool.end();
  log("stopped");
}

main().catch((e: unknown) => {
  console.error(`[worker ${workerId}] fatal:`, e);
  process.exit(1);
});
