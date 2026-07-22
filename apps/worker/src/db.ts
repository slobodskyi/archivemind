import pg from "pg";

/** pg Pool for the worker.
 *  Production: the Supabase SESSION pooler string (never direct 5432 — IPv6-only;
 *  never the 6543 transaction pooler — no LISTEN/prepared statements). Session
 *  mode pins one real backend connection per pooled client, so keep max small
 *  (TECH_SPEC §5). Local dev: plain local Postgres URL. */
export function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required (Supabase session-pooler string in production)");
  }
  return new pg.Pool({
    connectionString,
    // Floor of 2: the cluster handler holds a dedicated client across its whole
    // transaction while progress()/heartbeat() acquire a SECOND client from the
    // pool — max=1 would self-deadlock at the first in-transaction progress call.
    max: Math.max(2, Number(process.env.WORKER_POOL_MAX ?? 3)),
    // Supabase poolers terminate TLS with a cert the default CA set can't
    // verify; local Docker Postgres speaks no TLS at all.
    ssl: /supabase\.(co|com)/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
}
