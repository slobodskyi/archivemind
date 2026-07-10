import type pg from "pg";
import type { JobType } from "@archivemind/shared";
import type { Job } from "../queue";

export interface HandlerContext {
  pool: pg.Pool;
  job: Job;
  /** Report 0..100 progress — Realtime Broadcast picks it up via the DB trigger. */
  progress: (progress: number, label?: string, doneItems?: number, totalItems?: number) => Promise<void>;
}

export type JobHandler = (ctx: HandlerContext) => Promise<void>;

/** Registry — handlers land per phase: analyze (#10), caption (#13),
 *  export (#25). A claimed job with no handler goes through the normal retry
 *  path and fails with a clear error. */
export const handlers: Partial<Record<JobType, JobHandler>> = {
  ingest: (ctx) => import("./ingest").then((m) => m.ingestHandler(ctx)),
};
