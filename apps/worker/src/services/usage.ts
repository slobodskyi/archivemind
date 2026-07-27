import type pg from "pg";
import { costUsdFor, type UsageEventType } from "@archivemind/shared";

/** One row for `usage_events`. `model` belongs on AI events only; `bytes` on
 *  storage-moving ones (ingest). */
export interface UsageEvent {
  workspaceId: string;
  userId: string | null;
  jobId: string | null;
  type: UsageEventType;
  units: number;
  model?: string | null;
  bytes?: number | null;
}

/** Write usage rows, filling `cost_usd` from the shared estimate table.
 *
 *  Every handler used to hand-roll this INSERT, which is how `cost_usd` — a
 *  column present since migration 0001 and assumed by TECH_SPEC §12's audit
 *  trail — ended up written by nobody for four phases. Routing the writes
 *  through one function means a new handler gets the costing by default instead
 *  of by remembering.
 *
 *  Non-fatal by contract at the call sites: metering must never fail work the
 *  user already paid for. Callers that can tolerate it wrap this in `.catch()`;
 *  the search route does the same thing on the web side.
 */
export async function recordUsage(pool: pg.Pool, events: UsageEvent[]): Promise<void> {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const tuples = events.map((e, i) => {
    const b = i * 8;
    values.push(
      e.workspaceId,
      e.userId,
      e.jobId,
      e.type,
      e.units,
      e.model ?? null,
      e.bytes ?? null,
      // cost_usd is derived, never passed in — a caller cannot disagree with
      // the price table.
      costUsdFor(e.type, e.units),
    );
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
  });

  await pool.query(
    `insert into usage_events (workspace_id, user_id, job_id, event_type, units, model, bytes, cost_usd)
     values ${tuples.join(", ")}`,
    values,
  );
}
