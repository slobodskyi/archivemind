import { describe, expect, it, vi } from "vitest";
import { applyDedupAction, dedupDecision, ingestProgressLabel, isWhollyFailed } from "./ingest";

describe("dedupDecision (#118 + data-loss guards)", () => {
  // Legend: dedupDecision(survivorStatus, survivorDurable, incomingDurable)
  //   durable = the file holds a durable original in R2 (upload / Dropbox);
  //   a Drive row is never durable (r2_key null, ADR 0025).

  it("merges a plain duplicate into a healthy active survivor", () => {
    expect(dedupDecision("active", true, true)).toBe("merge");
    expect(dedupDecision("active", true, false)).toBe("merge");
  });

  it("merges two byte-less copies (both Drive links) — nothing durable to lose", () => {
    expect(dedupDecision("active", false, false)).toBe("merge");
  });

  it("revives a soft-deleted survivor that still has durable bytes", () => {
    // "I re-uploaded it to get it back" — reactivate rather than merge INTO a
    // tombstone (the #118 bug), safe because the survivor's bytes are intact.
    expect(dedupDecision("deleted", true, true)).toBe("revive-merge");
    expect(dedupDecision("deleted", false, false)).toBe("revive-merge");
  });

  it("NEVER drops the incoming durable original for a byte-less survivor", () => {
    // The data-loss finding: an upload (durable) dedup'ing against a Drive
    // survivor (no R2 bytes) must keep the durable copy, not destroy it.
    expect(dedupDecision("active", false, true)).toBe("stand-alone");
    expect(dedupDecision("deleted", false, true)).toBe("stand-alone");
  });

  it("never folds a fresh copy into a source_missing record — its source is gone", () => {
    expect(dedupDecision("source_missing", false, true)).toBe("stand-alone");
    expect(dedupDecision("source_missing", false, false)).toBe("stand-alone");
    expect(dedupDecision("source_missing", true, true)).toBe("stand-alone");
  });

  it("treats an unknown future status as a non-active survivor (fail safe)", () => {
    expect(dedupDecision("some_new_status", true, true)).toBe("revive-merge");
    expect(dedupDecision("some_new_status", false, true)).toBe("stand-alone");
  });
});

describe("isWhollyFailed (#119)", () => {
  it("is false for an empty batch — nothing to fail", () => {
    expect(isWhollyFailed(0, 0)).toBe(false);
  });

  it("is true only when every processed row genuinely failed", () => {
    expect(isWhollyFailed(50, 50)).toBe(true);
    expect(isWhollyFailed(1, 1)).toBe(true);
  });

  it("is false when anything survived or was handled (dedup / other / missing / success)", () => {
    expect(isWhollyFailed(50, 0)).toBe(false); // all clean
    expect(isWhollyFailed(50, 49)).toBe(false); // one survived — stays 'done'
    expect(isWhollyFailed(50, 2)).toBe(false); // partial failure — stays 'done'
    // source_missing counts as `missing`, not `failed`, so an all-missing batch
    // (failed=0) is NOT wholly failed — it completes 'done', no wasteful retry.
    expect(isWhollyFailed(5, 0)).toBe(false);
  });

  it("never fails a batch on a stale count larger than the total", () => {
    expect(isWhollyFailed(3, 5)).toBe(false);
  });
});

describe("ingestProgressLabel", () => {
  it("reports a clean run with no tail", () => {
    expect(ingestProgressLabel(10, 0, 0, 0)).toBe("Processed 10 file(s)");
  });

  it("appends each non-zero count in order", () => {
    expect(ingestProgressLabel(10, 3, 0, 0)).toBe("Processed 10 file(s) (3 deduped)");
    expect(ingestProgressLabel(10, 0, 2, 0)).toBe("Processed 10 file(s) (2 failed)");
    expect(ingestProgressLabel(10, 0, 0, 4)).toBe("Processed 10 file(s) (4 missing)");
    expect(ingestProgressLabel(10, 3, 2, 4)).toBe("Processed 10 file(s) (3 deduped, 2 failed, 4 missing)");
  });
});

describe("dedupDecision for a project share upload (ADR 0051 §10)", () => {
  const inside = { survivorInProject: true };
  const outside = { survivorInProject: false };

  it("merges only into an active file the link's own project already holds", () => {
    expect(dedupDecision("active", true, true, inside)).toBe("merge");
  });

  it("drops a duplicate of a file filed OUTSIDE the project, whatever its status or durability", () => {
    for (const status of ["active", "deleted", "source_missing"]) {
      for (const durable of [true, false]) expect(dedupDecision(status, durable, true, outside)).toBe("drop");
    }
  });

  it("never revives a trashed survivor, even inside the project", () => {
    expect(dedupDecision("deleted", true, true, inside)).toBe("drop");
    expect(dedupDecision("deleted", false, true, inside)).toBe("drop"); // a purged tombstone too
    expect(dedupDecision("some_new_status", true, true, inside)).toBe("drop");
  });

  it("keeps the durability rules inside the project", () => {
    expect(dedupDecision("active", false, true, inside)).toBe("stand-alone");
    expect(dedupDecision("source_missing", true, true, inside)).toBe("stand-alone");
  });

  it("leaves a member's re-add exactly as it was", () => {
    expect(dedupDecision("deleted", true, true, null)).toBe("revive-merge");
    expect(dedupDecision("deleted", true, true)).toBe("revive-merge");
  });
});

describe("applyDedupAction — what a link upload's duplicate writes", () => {
  const row = { asset_id: "incoming-asset", file_id: "incoming-file", r2_key: "ws/originals/r1/IMG.jpg" };
  const survivor = { asset_id: "survivor-asset", file_id: "survivor-file" };

  function recordingPool() {
    const queries: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
        return { rows: [] };
      }),
    };
    return { pool: pool as unknown as Parameters<typeof applyDedupAction>[0], queries };
  }

  const touchesSurvivor = (queries: { sql: string; params: unknown[] }[]) =>
    queries.filter(
      (q) =>
        !q.sql.startsWith("update project_share_uploads") &&
        (q.params.includes(survivor.asset_id) || q.params.includes(survivor.file_id)),
    );

  it("a duplicate inside the project merges: membership re-stated, ledger repointed, incoming copy gone", async () => {
    const { pool, queries } = recordingPool();
    const removeObject = vi.fn(async () => {});
    const action = dedupDecision("active", true, true, { survivorInProject: true });

    await expect(applyDedupAction(pool, action, row, survivor, { fromShare: true, removeObject })).resolves.toBe(true);

    expect(queries.map((q) => q.sql.split(" ").slice(0, 3).join(" "))).toEqual([
      "update project_share_uploads set",
      "insert into project_assets",
      "delete from files",
      "delete from assets",
    ]);
    expect(queries[0].params).toEqual([row.asset_id, survivor.asset_id]);
    expect(removeObject).toHaveBeenCalledWith(row.r2_key);
  });

  it("a duplicate in ANOTHER project is not linked and nothing about that asset changes", async () => {
    const { pool, queries } = recordingPool();
    const removeObject = vi.fn(async () => {});
    const action = dedupDecision("active", true, true, { survivorInProject: false });

    await expect(applyDedupAction(pool, action, row, survivor, { fromShare: true, removeObject })).resolves.toBe(true);

    expect(queries.some((q) => q.sql.includes("project_assets"))).toBe(false);
    expect(queries.some((q) => q.sql.startsWith("update assets") || q.sql.startsWith("update files"))).toBe(false);
    expect(touchesSurvivor(queries)).toEqual([]);
    // Recorded as delivered — the ledger names what it duplicates — then the copy goes.
    expect(queries[0]).toEqual({
      sql: "update project_share_uploads set asset_id = $2 where asset_id = $1",
      params: [row.asset_id, survivor.asset_id],
    });
    expect(queries.slice(1).map((q) => q.params)).toEqual([[row.file_id], [row.asset_id]]);
    expect(removeObject).toHaveBeenCalledWith(row.r2_key);
  });

  it("a trashed duplicate is still not revived", async () => {
    const { pool, queries } = recordingPool();
    const action = dedupDecision("deleted", true, true, { survivorInProject: true });

    await applyDedupAction(pool, action, row, survivor, { fromShare: true, removeObject: async () => {} });

    expect(queries.some((q) => q.sql.includes("status='active'"))).toBe(false);
    expect(queries.some((q) => q.sql.includes("project_assets"))).toBe(false);
    expect(touchesSurvivor(queries)).toEqual([]);
  });

  it("a member's re-add of a trashed photo still revives and merges, with no ledger write", async () => {
    const { pool, queries } = recordingPool();
    await applyDedupAction(pool, dedupDecision("deleted", true, true), row, survivor, {
      fromShare: false,
      removeObject: async () => {},
    });
    expect(queries.some((q) => q.sql.includes("project_share_uploads"))).toBe(false);
    expect(queries.some((q) => q.sql.includes("status='active'"))).toBe(true);
  });

  it("stand-alone only releases the survivor's hash and keeps the incoming copy", async () => {
    const { pool, queries } = recordingPool();
    const removeObject = vi.fn(async () => {});
    await expect(
      applyDedupAction(pool, "stand-alone", row, survivor, { fromShare: true, removeObject }),
    ).resolves.toBe(false);
    expect(queries).toEqual([{ sql: "update files set content_hash = null where id = $1", params: [survivor.file_id] }]);
    expect(removeObject).not.toHaveBeenCalled();
  });
});
