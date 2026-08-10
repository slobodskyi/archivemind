import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { clusterHandler } from "./cluster";

describe("clusterHandler editable-topic custody (ADR 0042)", () => {
  it("loads and mutates generated rows only, retaining override destinations below the floor", async () => {
    const transactionSql: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        transactionSql.push(sql);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("join embeddings")) return { rows: [] };
        if (sql.includes("from asset_tags")) return { rows: [] };
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };
    const progress = vi.fn(async () => {});

    await clusterHandler({
      pool: pool as unknown as pg.Pool,
      job: {
        id: "00000000-0000-0000-0000-000000000001",
        workspace_id: "00000000-0000-0000-0000-00000000aaaa",
        user_id: null,
        project_id: null,
        type: "cluster",
        payload: { workspace_id: "00000000-0000-0000-0000-00000000aaaa" },
        attempts: 1,
        total_items: 1,
        done_items: 0,
      },
      progress,
    });

    const existingRead = transactionSql.find((sql) => sql.includes("from topic_clusters tc"))!;
    expect(existingRead).toContain("tc.origin = 'generated'");
    expect(existingRead).toContain("tc.centroid is not null");
    expect(existingRead).toContain("from topic_cluster_overrides");

    const clusterDelete = transactionSql.find((sql) => sql.includes("delete from topic_clusters tc"))!;
    expect(clusterDelete).toContain("tc.origin = 'generated'");
    expect(clusterDelete).toContain("tc.is_renamed = false");
    expect(clusterDelete).toContain("not exists");
    expect(clusterDelete).toContain("topic_cluster_overrides");

    const retainedUpdate = transactionSql.find(
      (sql) => sql.includes("update topic_clusters tc") && sql.includes("tc.is_renamed = true"),
    )!;
    expect(retainedUpdate).toContain("tc.origin = 'generated'");
    expect(retainedUpdate).toContain("topic_cluster_overrides");
    expect(transactionSql.at(-1)).toBe("commit");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("re-checks a late human rename before deleting an unmatched generated row", async () => {
    const unit = (axis: number) => {
      const vector = Array<number>(768).fill(0);
      vector[axis] = 1;
      return vector;
    };
    const embeddings = Array.from({ length: 8 }, (_, index) => ({
      id: `00000000-0000-0000-0000-0000000000${index + 10}`,
      embedding: JSON.stringify(unit(index < 4 ? 0 : 1)),
    }));
    const transactionSql: string[] = [];
    let inserted = 0;
    const client = {
      query: vi.fn(async (sql: string) => {
        transactionSql.push(sql);
        if (sql.includes("select tc.id") && sql.includes("from topic_clusters tc")) {
          return {
            rows: [
              {
                id: "00000000-0000-0000-0000-00000000dead",
                label: "Old machine topic",
                centroid: JSON.stringify(unit(2)),
                is_renamed: false,
                has_overrides: false,
              },
            ],
          };
        }
        if (sql.includes("insert into topic_clusters")) {
          inserted += 1;
          return { rows: [{ id: `00000000-0000-0000-0000-${String(inserted).padStart(12, "0")}` }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("join embeddings")) return { rows: embeddings };
        if (sql.includes("from asset_tags")) return { rows: [] };
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    await clusterHandler({
      pool: pool as unknown as pg.Pool,
      job: {
        id: "00000000-0000-0000-0000-000000000001",
        workspace_id: "00000000-0000-0000-0000-00000000aaaa",
        user_id: null,
        project_id: null,
        type: "cluster",
        payload: { workspace_id: "00000000-0000-0000-0000-00000000aaaa" },
        attempts: 1,
        total_items: 8,
        done_items: 0,
      },
      progress: vi.fn(async () => {}),
    });

    const unmatchedDelete = transactionSql.find(
      (sql) => sql.includes("delete from topic_clusters tc") && sql.includes("id = any"),
    );
    expect(unmatchedDelete).toContain("tc.is_renamed = false");
    expect(unmatchedDelete).toContain("not exists");
  });
});
