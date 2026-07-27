import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

const deleteObject = vi.fn<(key: string) => Promise<void>>(async () => {});
vi.mock("./services/r2", () => ({ deleteObject: (key: string) => deleteObject(key) }));

const { sweepExpiredExports } = await import("./retention");

/** Minimal pg.Pool stand-in: `selectRows` answers the one select, every other
 *  query is recorded. The sweep DELETES R2 objects, so what it targets and what
 *  it leaves alone are worth pinning even without a database. */
function fakePool(selectRows: { id: string; result_key: string | null }[]) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return sql.includes("select") ? { rows: selectRows } : { rows: [] };
    }),
  };
  return { pool: pool as unknown as pg.Pool, queries };
}

beforeEach(() => {
  deleteObject.mockClear();
});

describe("sweepExpiredExports", () => {
  it("deletes each expired artifact and clears only that row's key", async () => {
    const { pool, queries } = fakePool([
      { id: "job-1", result_key: "ws-a/exports/job-1.pdf" },
      { id: "job-2", result_key: "ws-b/exports/job-2.pdf" },
    ]);

    await expect(sweepExpiredExports(pool)).resolves.toBe(2);

    expect(deleteObject.mock.calls.map(([k]) => k)).toEqual([
      "ws-a/exports/job-1.pdf",
      "ws-b/exports/job-2.pdf",
    ]);
    const updates = queries.filter((q) => q.sql.includes("update ai_jobs"));
    expect(updates).toHaveLength(2);
    // The row survives as the record of the export; only the key is dropped, so
    // GET /api/exports stops offering a download for bytes that are gone.
    expect(updates[0].sql).toContain("payload - 'result_key'");
    expect(updates.map((u) => u.params?.[0])).toEqual(["job-1", "job-2"]);
  });

  it("passes the retention window as a parameter, never interpolated", async () => {
    const { pool, queries } = fakePool([]);
    await sweepExpiredExports(pool);
    const select = queries.find((q) => q.sql.includes("select"));
    expect(select?.params).toEqual(["8"]);
    expect(select?.sql).toContain("$1");
    expect(select?.sql).not.toContain("8 days");
  });

  it("scopes to export jobs that still have a key, and bounds the batch", async () => {
    const { pool, queries } = fakePool([]);
    await sweepExpiredExports(pool);
    const sql = queries[0].sql;
    expect(sql).toContain("type = 'export'");
    expect(sql).toContain("payload ? 'result_key'");
    expect(sql).toContain("limit 500");
  });

  it("skips a row whose key is JSON null instead of deleting a bogus object", async () => {
    const { pool, queries } = fakePool([
      { id: "job-1", result_key: null },
      { id: "job-2", result_key: "ws/exports/job-2.pdf" },
    ]);

    await expect(sweepExpiredExports(pool)).resolves.toBe(1);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("ws/exports/job-2.pdf");
    expect(queries.filter((q) => q.sql.includes("update ai_jobs"))).toHaveLength(1);
  });

  it("does nothing, and reports nothing, when there is no expired export", async () => {
    const { pool } = fakePool([]);
    await expect(sweepExpiredExports(pool)).resolves.toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("propagates an R2 failure so the next sweep retries, leaving the key in place", async () => {
    deleteObject.mockRejectedValueOnce(new Error("r2 down"));
    const { pool, queries } = fakePool([{ id: "job-1", result_key: "ws/exports/job-1.pdf" }]);

    await expect(sweepExpiredExports(pool)).rejects.toThrow("r2 down");
    // Key NOT cleared — otherwise the object would be an unreclaimable orphan.
    expect(queries.filter((q) => q.sql.includes("update ai_jobs"))).toHaveLength(0);
  });
});
