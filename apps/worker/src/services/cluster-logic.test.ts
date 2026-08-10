import { describe, expect, it } from "vitest";
import {
  clusterEmbeddings,
  fnv1a,
  labelClusters,
  LABEL_STOPLIST,
  matchClusters,
  mulberry32,
  pickK,
  planClusters,
  uniqueLabel,
  UNLABELED,
  type ClusterInput,
  type ClusterLabel,
  type ComputedCluster,
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

// ── ADR 0038: naming a cloud the way a person would ─────────────────────────

/** A cluster fixture where each member's tags are given directly. `tags` uses
 *  the same [category, name] tuple order as `input` above. */
function labelOf(members: [string, [string, string][]][], others: [string, [string, string][]][] = []): ClusterLabel {
  const all: ClusterInput[] = [...members, ...others].map(([id, tags]) => input(id, [1, 0], tags));
  const cluster: ComputedCluster = { centroid: [1, 0], assetIds: members.map(([id]) => id) };
  return labelClusters([cluster], all)[0];
}

const rep = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

describe("labelClusters — representativeness, not just discriminativeness", () => {
  it("a one-photo outlier tag cannot outrank the tag the whole cluster carries", () => {
    // The real failure this fixes: 6 screenshots, one of which happens to show
    // a book cover with a price tag. Under a pure clDf/wsDf ratio those two
    // hapaxes score 1.0 — the maximum — and named the cloud "book cover ·
    // price tag". Both are also in "others" nowhere, so nothing but the
    // support term can demote them.
    const members: [string, [string, string][]][] = [
      ...rep(5, (i): [string, [string, string][]] => [
        `s${i}`,
        [
          ["scene", "protest"],
          ["object", "flag"],
        ],
      ]),
      ["s5", [["object", "book cover"], ["object", "price tag"], ["scene", "protest"]]],
    ];
    // Three more protest photos elsewhere in the workspace, so "protest" is not
    // perfectly discriminative and would lose on ratio alone (6/9 vs 1/1).
    const others = rep(3, (i): [string, [string, string][]] => [`o${i}`, [["scene", "protest"]]]);
    const { label, pool } = labelOf(members, others);
    // flag (5 of 6, found nowhere else) scores 25/5 = 5; protest (6 of 6, but
    // 3 more elsewhere) scores 36/9 = 4. Both name the cluster honestly — the
    // point is that neither hapax is anywhere near them.
    expect(label).toBe("flag · protest");
    expect(pool.slice(0, 2)).toEqual(["flag", "protest"]);
    expect(pool).not.toContain("book cover"); // dropped by the support tier, not merely outranked
    expect(pool).not.toContain("price tag");
  });

  it("does not pad a second tag that covers almost nothing", () => {
    const members: [string, [string, string][]][] = [
      ...rep(20, (i): [string, [string, string][]] => [`m${i}`, [["scene", "street"]]]),
      ["m20", [["scene", "street"], ["object", "yoga"]]],
      ["m21", [["scene", "street"], ["object", "yoga"]]],
    ];
    expect(labelOf(members).label).toBe("street");
  });

  it("demotes medium/format words but still uses one when nothing else is left", () => {
    const screenshots = rep(6, (i): [string, [string, string][]] => [
      `p${i}`,
      [
        ["scene", "screenshot"],
        ["object", "smartphone"],
      ],
    ]);
    // Tier 4 — everything is stop-listed, so the honest name is the medium, and
    // exactly one word of it: "screenshot · smartphone" (the label this whole
    // change exists to kill) adds nothing to "screenshot".
    expect(labelOf(screenshots).label).toBe("screenshot");

    // Add a real subject to most of them and the medium words step aside.
    const withSubject = screenshots.map(([id, tags], i): [string, [string, string][]] =>
      i < 5 ? [id, [...tags, ["event", "protest"] as [string, string]]] : [id, tags],
    );
    expect(labelOf(withSubject).label).toBe("protest");
  });

  it("keeps a weak name over no name at all (the relaxing tiers)", () => {
    // place/kyiv on 1 of 2 photos: fails the thematic tier and the support
    // tier, passes tier 3. Naming it "Unlabeled" would be worse.
    expect(labelOf([["a0", [["place", "kyiv"]]], ["a1", []]]).label).toBe("kyiv");
    expect(labelOf([["a0", []], ["a1", []]]).label).toBe(UNLABELED);
  });

  it("is invariant to member and workspace ordering", () => {
    const members: [string, [string, string][]][] = rep(8, (i) => [
      `m${i}`,
      i < 6 ? [["scene", "rubble"], ["object", "crane"]] : [["object", `junk-${i}`]],
    ]);
    const forward = labelOf(members);
    const reversed = labelOf([...members].reverse());
    expect(reversed.label).toBe(forward.label);
    expect(reversed.pool).toEqual(forward.pool);
  });

  it("the stop-list holds medium words and no real subjects", () => {
    for (const w of ["screenshot", "smartphone", "photo", "close-up"]) {
      expect(LABEL_STOPLIST.has(w)).toBe(true);
    }
    for (const w of ["protest", "flag", "yoga", "kyiv", "rubble"]) {
      expect(LABEL_STOPLIST.has(w)).toBe(false);
    }
  });
});

describe("uniqueLabel — differentiate, never extend", () => {
  const base = (label: string, pool: string[]): ClusterLabel => ({ label, pool });

  it("swaps the second tag instead of appending a third", () => {
    const taken = new Set(["floor · mat"]);
    const out = uniqueLabel(base("floor · mat", ["floor", "mat", "wall"]), taken);
    expect(out).toBe("floor · wall");
    expect(out.split(" · ")).toHaveLength(2); // never a 3-tag label
  });

  it("falls back to a numeric suffix only when the pool is exhausted", () => {
    expect(uniqueLabel(base(UNLABELED, []), new Set([UNLABELED]))).toBe("Unlabeled (2)");
    expect(uniqueLabel(base(UNLABELED, []), new Set([UNLABELED, "Unlabeled (2)"]))).toBe("Unlabeled (3)");
  });

  it("returns the natural label untouched when it is free", () => {
    expect(uniqueLabel(base("protest · flag", ["protest", "flag"]), new Set())).toBe("protest · flag");
  });
});

describe("planClusters — renamed clusters are pinned (ADR 0038)", () => {
  const rows = twoGroups();
  const firstRun = () => planClusters(rows, [], "ws")!;

  it("recomputes a machine label on a matched cluster, but reports the stored one", () => {
    const first = firstRun();
    const existing: ExistingCluster[] = first.insert.map((c, i) => ({
      id: `c${i}`,
      label: "stale name",
      centroid: c.centroid,
    }));
    const plan = planClusters(rows, existing, "ws")!;
    expect(plan.update).toHaveLength(2);
    for (const u of plan.update) {
      expect(u.label).toBe("stale name"); // what is stored right now
      expect(u.relabel).not.toBeNull(); // what this run wants it called
      expect(u.relabel).not.toBe("stale name");
    }
  });

  it("leaves a user-renamed cluster's label alone", () => {
    const first = firstRun();
    const existing: ExistingCluster[] = first.insert.map((c, i) => ({
      id: `c${i}`,
      label: i === 0 ? "Morning practice" : "stale name",
      centroid: c.centroid,
      isRenamed: i === 0,
    }));
    const plan = planClusters(rows, existing, "ws")!;
    const pinned = plan.update.find((u) => u.id === "c0")!;
    const free = plan.update.find((u) => u.id === "c1")!;
    expect(pinned.relabel).toBeNull(); // the handler then writes no label at all
    expect(free.relabel).not.toBeNull();
    // and the pinned name is reserved, so the other cluster cannot take it
    expect(free.relabel).not.toBe("Morning practice");
  });

  it("retains an unmatched renamed cluster instead of deleting it", () => {
    const orthogonal = near(8, 5);
    const plan = planClusters(
      rows,
      [
        { id: "machine", label: "obsolete", centroid: orthogonal },
        { id: "human", label: "Morning practice", centroid: near(8, 6), isRenamed: true },
      ],
      "ws",
    )!;
    expect(plan.deleteIds).toEqual(["machine"]);
    expect(plan.retainIds).toEqual(["human"]);
  });

  it("retains an unmatched generated cluster when a manual override points at it", () => {
    const plan = planClusters(
      rows,
      [
        { id: "free", label: "obsolete", centroid: near(8, 5) },
        {
          id: "assigned-into",
          label: "Family",
          centroid: near(8, 6),
          isProtected: true,
        },
      ],
      "ws",
    )!;
    expect(plan.deleteIds).toEqual(["free"]);
    expect(plan.retainIds).toEqual(["assigned-into"]);
  });

  it("is deterministic under any input ordering", () => {
    const existing: ExistingCluster[] = firstRun().insert.map((c, i) => ({
      id: `c${i}`,
      label: `old-${i}`,
      centroid: c.centroid,
    }));
    const a = planClusters(rows, existing, "ws")!;
    const b = planClusters([...rows].reverse(), [...existing].reverse(), "ws")!;
    expect(b.update.map((u) => [u.id, u.relabel])).toEqual(a.update.map((u) => [u.id, u.relabel]));
    expect(b.insert.map((i) => i.label)).toEqual(a.insert.map((i) => i.label));
  });
});
