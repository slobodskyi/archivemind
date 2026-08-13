import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

const deleteObject = vi.fn<(key: string) => Promise<void>>(async () => {});
vi.mock("./services/r2", () => ({ deleteObject: (key: string) => deleteObject(key) }));

const { sweepExpiredExports, sweepPublicationShares } = await import("./retention");

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

type PublicationRow = {
  share_id: string;
  workspace_id: string;
  public_id: string;
  preview_r2_key: string;
};

function publicationPool(selectRows: PublicationRow[], unclaimable = new Set<string>()) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("with candidates")) return { rows: selectRows };
      if (sql.includes("update publication_shares")) {
        const shareId = String(params?.[0]);
        const row = selectRows.find((candidate) => candidate.share_id === shareId);
        return {
          rows: !row || unclaimable.has(shareId) ? [] : [{ workspace_id: row.workspace_id }],
        };
      }
      return { rows: [] };
    }),
  };
  return { pool: pool as unknown as pg.Pool, queries };
}

const shareA = "00000000-0000-0000-0000-0000000000a1";
const shareB = "00000000-0000-0000-0000-0000000000b2";
const workspaceA = "00000000-0000-0000-0000-00000000aaaa";
const workspaceB = "00000000-0000-0000-0000-00000000bbbb";
const publicA1 = "10000000-0000-0000-0000-000000000001";
const publicA2 = "10000000-0000-0000-0000-000000000002";
const publicB1 = "20000000-0000-0000-0000-000000000001";

describe("sweepPublicationShares", () => {
  it("revokes first, deletes exact share-owned previews, then drops only the private map", async () => {
    const keyA1 = `${workspaceA}/shares/${shareA}/previews/${publicA1}.webp`;
    const keyA2 = `${workspaceA}/shares/${shareA}/previews/${publicA2}.webp`;
    const { pool, queries } = publicationPool([
      { share_id: shareA, workspace_id: workspaceA, public_id: publicA1, preview_r2_key: keyA1 },
      { share_id: shareA, workspace_id: workspaceA, public_id: publicA2, preview_r2_key: keyA2 },
    ]);

    await expect(sweepPublicationShares(pool)).resolves.toBe(1);

    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual([keyA1, keyA2]);
    const claimIndex = queries.findIndex((query) => query.sql.includes("update publication_shares"));
    const mapDeleteIndex = queries.findIndex((query) =>
      query.sql.includes("delete from publication_share_assets"),
    );
    expect(claimIndex).toBeGreaterThan(-1);
    expect(mapDeleteIndex).toBeGreaterThan(claimIndex);
    expect(queries[mapDeleteIndex].params).toEqual([shareA]);
    expect(queries.some((query) => query.sql.includes("delete from publication_shares"))).toBe(false);
  });

  it("selects whole bounded shares across revoked, expired, and abandoned states", async () => {
    const { pool, queries } = publicationPool([]);
    await sweepPublicationShares(pool);

    const select = queries[0];
    expect(select.params).toEqual([24]);
    expect(select.sql).toContain("ps.status = 'revoked'");
    expect(select.sql).toContain("ps.status = 'ready' and ps.expires_at");
    expect(select.sql).toContain("ps.status = 'preparing'");
    expect(select.sql).toContain("make_interval(hours => $1::int)");
    expect(select.sql).toContain("limit 100");
    expect(select.sql).toContain("join publication_share_assets");
  });

  it("never deletes a key that is not the exact public preview mapping", async () => {
    const original = `${workspaceA}/originals/private.jpg`;
    const { pool, queries } = publicationPool([
      {
        share_id: shareA,
        workspace_id: workspaceA,
        public_id: publicA1,
        preview_r2_key: original,
      },
    ]);

    await expect(sweepPublicationShares(pool)).resolves.toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
    // It is still terminally revoked, but the suspicious mapping remains so an
    // operator can investigate it without losing the only DB→R2 reference.
    expect(queries.some((query) => query.sql.includes("update publication_shares"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("delete from publication_share_assets"))).toBe(
      false,
    );
  });

  it("contains one R2 failure, keeps its mapping, and cleans the next share", async () => {
    const keyA = `${workspaceA}/shares/${shareA}/previews/${publicA1}.webp`;
    const keyB = `${workspaceB}/shares/${shareB}/previews/${publicB1}.webp`;
    deleteObject.mockRejectedValueOnce(new Error("r2 down"));
    const { pool, queries } = publicationPool([
      { share_id: shareA, workspace_id: workspaceA, public_id: publicA1, preview_r2_key: keyA },
      { share_id: shareB, workspace_id: workspaceB, public_id: publicB1, preview_r2_key: keyB },
    ]);

    await expect(sweepPublicationShares(pool)).resolves.toBe(1);
    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual([keyA, keyB]);
    const mapDeletes = queries.filter((query) =>
      query.sql.includes("delete from publication_share_assets"),
    );
    expect(mapDeletes.map((query) => query.params?.[0])).toEqual([shareB]);
  });

  it("leaves a share alone if it became live before the guarded claim", async () => {
    const key = `${workspaceA}/shares/${shareA}/previews/${publicA1}.webp`;
    const { pool, queries } = publicationPool(
      [{ share_id: shareA, workspace_id: workspaceA, public_id: publicA1, preview_r2_key: key }],
      new Set([shareA]),
    );

    await expect(sweepPublicationShares(pool)).resolves.toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(queries.some((query) => query.sql.includes("delete from publication_share_assets"))).toBe(
      false,
    );
  });

  it("does nothing when only text-only or still-live shares exist", async () => {
    const { pool } = publicationPool([]);
    await expect(sweepPublicationShares(pool)).resolves.toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
