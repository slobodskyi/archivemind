import { describe, expect, it } from "vitest";
import {
  clusterEmbeddings,
  fnv1a,
  labelClusters,
  matchClusters,
  mulberry32,
  pickK,
  planClusters,
  type ClusterInput,
  type ExistingCluster,
} from "./cluster-logic";

/** A D-dim unit-ish vector pointing along `axis`, nudged by `jitter` on the
 *  next axis so points in a group are near-identical but not identical. */
const near = (dims: number, axis: number, jitter = 0): number[] => {
  const v = new Array<number>(dims).fill(0);
  v[axis] = 1;
  if (jitter) v[(axis + 1) % dims] = jitter;
  return v;
};

const input = (id: string, embedding: number[], tags: [string, string][] = []): ClusterInput => ({
  assetId: id,
  embedding,
  tags: tags.map(([category, name]) => ({ category, name })),
});

/** Two orthogonal groups of 5, ids a0..a4 (axis 0) and b0..b4 (axis 1). */
function twoGroups(dims = 8): ClusterInput[] {
  const rows: ClusterInput[] = [];
  for (let i = 0; i < 5; i++) rows.push(input(`a${i}`, near(dims, 0, i * 0.01)));
  for (let i = 0; i < 5; i++) rows.push(input(`b${i}`, near(dims, 1, i * 0.01)));
  return rows;
}

describe("pickK", () => {
  it("is clamp(round(sqrt(n/2)), 2, 12)", () => {
    expect(pickK(8)).toBe(2); // round(sqrt(4))
    expect(pickK(288)).toBe(12); // round(sqrt(144))
    expect(pickK(2)).toBe(2); // round(1) → clamp up
    expect(pickK(100000)).toBe(12); // clamp down
  });
});

describe("PRNG determinism", () => {
  it("fnv1a is a pure hash of the string", () => {
    expect(fnv1a("ws-1")).toBe(fnv1a("ws-1"));
    expect(fnv1a("ws-1")).not.toBe(fnv1a("ws-2"));
  });

  it("mulberry32 yields the same stream for the same seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const streamA = [a(), a(), a(), a()];
    const streamB = [b(), b(), b(), b()];
    expect(streamA).toEqual(streamB);
    for (const x of streamA) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThan(1);
  });
});

describe("clusterEmbeddings", () => {
  it("recovers two well-separated groups", () => {
    const clusters = clusterEmbeddings(twoGroups(), "ws");
    expect(clusters).toHaveLength(2);
    const groups = clusters.map((c) => [...c.assetIds].sort()).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    expect(groups[0]).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(groups[1]).toEqual(["b0", "b1", "b2", "b3", "b4"]);
  });

  it("is invariant to input order (the determinism contract)", () => {
    const rows = twoGroups();
    const forward = clusterEmbeddings(rows, "ws");
    const reversed = clusterEmbeddings([...rows].reverse(), "ws");
    const shuffled = clusterEmbeddings([rows[7], rows[2], rows[9], rows[0], rows[5], rows[1], rows[8], rows[3], rows[6], rows[4]], "ws");
    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it("assigns every asset to exactly one cluster, even with duplicate points", () => {
    // 7 identical + 1 distinct: exercises empty-cluster reseeding deterministically.
    const rows: ClusterInput[] = [];
    for (let i = 0; i < 7; i++) rows.push(input(`d${i}`, near(8, 0)));
    rows.push(input("d7", near(8, 3)));
    const first = clusterEmbeddings(rows, "ws");
    const second = clusterEmbeddings([...rows].reverse(), "ws");
    expect(second).toEqual(first);
    const seen = first.flatMap((c) => c.assetIds).sort();
    expect(seen).toEqual(["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
  });

  it("returns centroids as unit vectors", () => {
    const clusters = clusterEmbeddings(twoGroups(), "ws");
    for (const c of clusters) {
      const norm = Math.sqrt(c.centroid.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1, 6);
    }
  });
});

describe("labelClusters", () => {
  it("labels by the most discriminative tags, thematic categories preferred", () => {
    const inputs = [
      input("a0", near(4, 0), [["event", "protest"], ["place", "kyiv"], ["object", "flag"]]),
      input("a1", near(4, 0), [["event", "protest"], ["place", "kyiv"], ["object", "flag"]]),
      input("b0", near(4, 1), [["object", "yoga"], ["place", "kyiv"]]),
      input("b1", near(4, 1), [["object", "yoga"], ["place", "kyiv"]]),
    ];
    const clusters = [
      { centroid: near(4, 0), assetIds: ["a0", "a1"] },
      { centroid: near(4, 1), assetIds: ["b0", "b1"] },
    ];
    const [ca, cb] = labelClusters(clusters, inputs);
    // "protest" and "flag" sit only in cluster A (ratio 1); "kyiv" is ambient
    // across both AND a place category, so it is not a thematic candidate.
    expect(ca.label).toBe("flag · protest"); // ratio ties → name asc
    expect(cb.label).toBe("yoga");
  });

  it("falls back to any category, then to Unlabeled", () => {
    const inputs = [
      input("a0", near(4, 0), [["place", "kyiv"]]),
      input("a1", near(4, 0), []),
    ];
    const [c] = labelClusters([{ centroid: near(4, 0), assetIds: ["a0", "a1"] }], inputs);
    expect(c.label).toBe("kyiv"); // no thematic tag → any category
    const [empty] = labelClusters([{ centroid: near(4, 0), assetIds: ["a1"] }], inputs);
    expect(empty.label).toBe("Unlabeled");
  });
});

describe("matchClusters", () => {
  it("matches similar centroids and leaves distant ones unmatched", () => {
    const same = matchClusters([near(4, 0)], [near(4, 0)]);
    expect(same.matches).toHaveLength(1);

    const apart = matchClusters([near(4, 0)], [near(4, 1)]);
    expect(apart.matches).toHaveLength(0);
    expect(apart.unmatchedComputed).toEqual([0]);
    expect(apart.unmatchedExisting).toEqual([0]);
  });

  it("is greedy one-to-one, highest similarity first (2×2)", () => {
    const { matches } = matchClusters([near(4, 0), near(4, 1)], [near(4, 0), near(4, 1)]);
    const pairing = matches.map((m) => [m.computedIdx, m.existingIdx]).sort();
    expect(pairing).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe("planClusters", () => {
  it("returns null below the clustering floor", () => {
    const rows = Array.from({ length: 7 }, (_, i) => input(`x${i}`, near(8, i % 2)));
    expect(planClusters(rows, [], "ws")).toBeNull();
  });

  it("inserts everything on a first run (no existing clusters)", () => {
    const plan = planClusters(twoGroups(), [], "ws");
    expect(plan).not.toBeNull();
    expect(plan!.insert).toHaveLength(2);
    expect(plan!.update).toHaveLength(0);
    expect(plan!.deleteIds).toHaveLength(0);
  });

  it("keeps ids AND labels stable on a re-run of the same corpus", () => {
    const rows = twoGroups();
    const first = planClusters(rows, [], "ws")!;
    // Persist the inserted clusters as existing rows, then re-run.
    const existing: ExistingCluster[] = first.insert.map((c, i) => ({
      id: `cluster-${i}`,
      label: c.label,
      centroid: c.centroid,
    }));
    const second = planClusters(rows, existing, "ws")!;
    expect(second.insert).toHaveLength(0);
    expect(second.deleteIds).toHaveLength(0);
    expect(second.update).toHaveLength(2);
    for (const u of second.update) {
      const original = existing.find((e) => e.id === u.id)!;
      expect(u.label).toBe(original.label); // label preserved
    }
  });

  it("deletes an existing cluster that no longer matches", () => {
    const rows = twoGroups();
    const stale: ExistingCluster[] = [{ id: "gone", label: "obsolete", centroid: near(8, 5) }];
    const plan = planClusters(rows, stale, "ws")!;
    expect(plan.deleteIds).toEqual(["gone"]);
    expect(plan.insert).toHaveLength(2);
  });
});
