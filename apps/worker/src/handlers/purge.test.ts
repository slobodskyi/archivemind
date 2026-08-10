import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

const deleteObject = vi.fn<(key: string) => Promise<void>>(async () => {});
vi.mock("../services/r2", () => ({ deleteObject: (key: string) => deleteObject(key) }));

const { purgeExportArtifacts, purgeHandler } = await import("./purge");

/** Minimal pg.Pool stand-in: the select answers with `rows`, updates are recorded. */
function fakePool(rows: { id: string; result_key: string | null }[]) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return sql.trimStart().startsWith("select") ? { rows } : { rows: [] };
    }),
  };
  return { pool: pool as unknown as pg.Pool, queries };
}

beforeEach(() => {
  deleteObject.mockClear();
});

describe("purgeExportArtifacts", () => {
  it("deletes every artifact containing the asset and clears each key", async () => {
    const { pool, queries } = fakePool([
      { id: "job-1", result_key: "ws/exports/job-1.pdf" },
      { id: "job-2", result_key: "ws/exports/job-2.zip" },
    ]);

    await expect(purgeExportArtifacts(pool, "asset-1")).resolves.toBe(2);
    expect(deleteObject.mock.calls.map(([k]) => k)).toEqual([
      "ws/exports/job-1.pdf",
      "ws/exports/job-2.zip",
    ]);
    const updates = queries.filter((q) => q.sql.includes("update ai_jobs"));
    // The ai_jobs row survives as the record of the export; only the key goes, so
    // GET /api/exports stops offering a download for bytes that no longer exist.
    expect(updates.map((u) => u.params?.[0])).toEqual(["job-1", "job-2"]);
    expect(updates[0].sql).toContain("payload - 'result_key'");
  });

  it("matches the RENDERED set, and the legacy requested set, and nothing else", async () => {
    const { pool, queries } = fakePool([]);
    await purgeExportArtifacts(pool, "asset-1");
    const sql = queries[0].sql;
    // exported_asset_ids is what the job actually rendered — the only reliable
    // record, since a group export carries no asset list and membership drifts.
    expect(sql).toContain("payload->'exported_asset_ids' @> to_jsonb($1::text)");
    // asset_ids covers artifacts written before that field existed.
    expect(sql).toContain("payload->'asset_ids' @> to_jsonb($1::text)");
    expect(sql).toContain("type = 'export'");
    // Only artifacts that still exist.
    expect(sql).toContain("payload ? 'result_key'");
    // Belt: an asset id is unique, but a pathological payload must not reach
    // another workspace's artifact.
    expect(sql).toContain("workspace_id = (select workspace_id from assets where id = $1)");
    expect(queries[0].params).toEqual(["asset-1"]);
  });

  it("does nothing when the asset was never exported", async () => {
    const { pool, queries } = fakePool([]);
    await expect(purgeExportArtifacts(pool, "asset-1")).resolves.toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(queries.filter((q) => q.sql.includes("update ai_jobs"))).toHaveLength(0);
  });

  it("skips a row whose key is JSON null rather than deleting a bogus object", async () => {
    const { pool } = fakePool([
      { id: "job-1", result_key: null },
      { id: "job-2", result_key: "ws/exports/job-2.pdf" },
    ]);
    await expect(purgeExportArtifacts(pool, "asset-1")).resolves.toBe(1);
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith("ws/exports/job-2.pdf");
  });

  it("propagates an R2 failure with the key left in place, so the sweep retries", async () => {
    deleteObject.mockRejectedValueOnce(new Error("r2 down"));
    const { pool, queries } = fakePool([{ id: "job-1", result_key: "ws/exports/job-1.pdf" }]);
    await expect(purgeExportArtifacts(pool, "asset-1")).rejects.toThrow("r2 down");
    // Clearing the key on a failed delete would orphan the object for good.
    expect(queries.filter((q) => q.sql.includes("update ai_jobs"))).toHaveLength(0);
  });
});

describe("purgeHandler editable-Topic cleanup (ADR 0042)", () => {
  it("removes the override when permanent purge leaves the asset tombstone behind", async () => {
    const queries: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith("update assets set purged_at")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as pg.Pool;

    await purgeHandler({
      pool,
      job: {
        id: "00000000-0000-0000-0000-000000000001",
        workspace_id: "00000000-0000-0000-0000-00000000aaaa",
        user_id: null,
        project_id: null,
        type: "purge",
        payload: { asset_ids: ["00000000-0000-0000-0000-0000000000f1"] },
        attempts: 1,
        total_items: 1,
        done_items: 0,
      },
      progress: vi.fn(async () => {}),
    });

    const overrideDelete = queries.findIndex((sql) =>
      sql.includes("delete from topic_cluster_overrides where asset_id = $1"),
    );
    const tombstoneUpdate = queries.findIndex((sql) =>
      sql.includes("update assets set cluster_id = null"),
    );
    expect(overrideDelete).toBeGreaterThan(-1);
    expect(tombstoneUpdate).toBeGreaterThan(overrideDelete);
  });
});
