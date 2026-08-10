import { describe, expect, it } from "vitest";
import {
  clusterTopicKey,
  deriveTopicAssignments,
  deriveTopics,
  heuristicTopicKey,
  TOPIC_CLOUD_CAP,
  TOPIC_OTHER_KEY,
  UNSORTED_CLOUD_KEY,
  type TopicAsset,
} from "./topics";

const asset = (id: string, tags: [string, string][]): TopicAsset => ({
  id,
  tags: tags.map(([category, name]) => ({ category, name })),
});

describe("deriveTopics (ADR 0023)", () => {
  it("sends untagged (unanalyzed) assets to Unsorted", () => {
    const topics = deriveTopics([asset("a", []), asset("b", [["object", "mat"]])]);
    expect(topics.get("a")).toBe(UNSORTED_CLOUD_KEY);
    expect(topics.get("b")).toBe("mat");
  });

  it("prefers event over scene over object even when a lower category would win on count AND name", () => {
    // scene "atelier" is on 3 of 5 assets (viable: ambientMax = floor(3) = 3),
    // beats event "protest" on count (3 vs 1) and on name ("atelier" < "protest") —
    // only the category priority can make `a` pick the event tag. A flattened
    // "most-shared viable tag across all categories" implementation fails here.
    const topics = deriveTopics([
      asset("a", [["scene", "atelier"], ["event", "protest"]]),
      asset("b", [["scene", "atelier"]]),
      asset("c", [["scene", "atelier"]]),
      asset("d", [["object", "mat"]]),
      asset("e", [["object", "mat"]]),
    ]);
    expect(topics.get("a")).toBe("protest");
    expect(topics.get("b")).toBe("atelier");
  });

  it("picks the most-shared viable tag within a category, name tie-break", () => {
    const topics = deriveTopics([
      asset("a", [["object", "mat"], ["object", "block"]]),
      asset("b", [["object", "mat"]]),
      asset("c", [["object", "zebra"], ["object", "block"]]),
      asset("d", [["object", "unrelated"]]),
      asset("e", [["object", "mat"]]),
    ]);
    expect(topics.get("a")).toBe("mat"); // mat:3 beats block:2
    expect(topics.get("c")).toBe("block"); // block:2 beats zebra:1
  });

  it("breaks equal-count candidates by name, not input order", () => {
    const topics = deriveTopics([
      asset("a", [["object", "mat"], ["object", "block"]]),
      asset("b", [["object", "block"], ["object", "mat"]]),
    ]);
    // Both tags have count 2 → lexicographic winner, same for both assets.
    expect(topics.get("a")).toBe("block");
    expect(topics.get("b")).toBe("block");
  });

  it("skips ambient tags carried by most of the archive", () => {
    // "yoga" on 4 of 5 tagged assets (> 60%) names the archive, not a theme.
    const topics = deriveTopics([
      asset("a", [["object", "yoga"], ["object", "mat"]]),
      asset("b", [["object", "yoga"], ["object", "mat"]]),
      asset("c", [["object", "yoga"], ["object", "banner"]]),
      asset("d", [["object", "yoga"]]),
      asset("e", [["object", "banner"]]),
    ]);
    expect(topics.get("a")).toBe("mat");
    expect(topics.get("b")).toBe("mat");
    expect(topics.get("c")).toBe("banner");
    expect(topics.get("d")).toBe("yoga"); // nothing but the ambient tag → keeps it, not Other
    expect(topics.get("e")).toBe("banner");
  });

  it("treats a tag on more than the fraction as ambient at round-up sizes too", () => {
    // 4 of 6 = 66.7% > 60% must be ambient: floor(3.6) = 3, not round → 4.
    const topics = deriveTopics([
      asset("a", [["object", "yoga"], ["object", "mat"]]),
      asset("b", [["object", "yoga"], ["object", "mat"]]),
      asset("c", [["object", "yoga"], ["object", "banner"]]),
      asset("d", [["object", "yoga"], ["object", "banner"]]),
      asset("e", [["object", "mat"]]),
      asset("f", [["object", "banner"]]),
    ]);
    expect(topics.get("a")).toBe("mat");
    expect(topics.get("c")).toBe("banner");
    expect([...deriveTopics([]).values()]).toEqual([]);
  });

  it("keeps a tiny archive's only shared tag as its cloud instead of renaming it to Other", () => {
    // The 2-photo archive shows a "yoga" cloud; adding a third identically
    // tagged photo must NOT rename that cloud to "Other".
    const two = deriveTopics([
      asset("a", [["object", "yoga"]]),
      asset("b", [["object", "yoga"]]),
    ]);
    const three = deriveTopics([
      asset("a", [["object", "yoga"]]),
      asset("b", [["object", "yoga"]]),
      asset("c", [["object", "yoga"]]),
    ]);
    expect(two.get("a")).toBe("yoga");
    expect(three.get("a")).toBe("yoga");
    expect(three.get("c")).toBe("yoga");
  });

  it("counts a category-drifted name as one tag when deciding ambient", () => {
    // "kyiv" is on 4 of 5 assets, split 2×scene + 2×event by re-analyze drift.
    // Counting the halves separately (2 ≤ ambientMax) would let it name a
    // topic; merged by name it is ambient, so `a` clusters by "mat" instead.
    const topics = deriveTopics([
      asset("a", [["scene", "kyiv"], ["object", "mat"]]),
      asset("b", [["object", "mat"]]),
      asset("c", [["event", "kyiv"]]),
      asset("d", [["scene", "kyiv"]]),
      asset("e", [["event", "kyiv"]]),
    ]);
    expect(topics.get("a")).toBe("mat");
    expect(topics.get("c")).toBe("kyiv"); // ambient-only asset keeps the tag
  });

  it("sends assets with no thematic-category tags to Other", () => {
    const topics = deriveTopics([
      asset("a", [["place", "kyiv"], ["attribute", "uniform"], ["other", "misc"]]),
      asset("b", [["object", "mat"]]),
    ]);
    expect(topics.get("a")).toBe(TOPIC_OTHER_KEY);
  });

  it("folds topics beyond the cloud cap into Other (smallest first)", () => {
    // TOPIC_CLOUD_CAP + 1 topics: t00 has 3 members, t01..tNN have 1 each.
    // Zero-padded names so the lexicographic tie-break matches numeric order
    // at any cap value — the comparator-last singleton is always the folded one.
    const pad = (n: number) => `t${String(n).padStart(2, "0")}`;
    const assets: TopicAsset[] = [
      asset("a0", [["object", pad(0)]]),
      asset("a1", [["object", pad(0)]]),
      asset("a2", [["object", pad(0)]]),
      ...Array.from({ length: TOPIC_CLOUD_CAP }, (_, i) =>
        asset(`s${i}`, [["object", pad(i + 1)]]),
      ),
    ];
    const topics = deriveTopics(assets);
    const named = new Set(
      [...topics.values()].filter((t) => t !== TOPIC_OTHER_KEY && t !== UNSORTED_CLOUD_KEY),
    );
    expect(named.size).toBe(TOPIC_CLOUD_CAP);
    expect(named.has(pad(0))).toBe(true);
    expect(topics.get(`s${TOPIC_CLOUD_CAP - 1}`)).toBe(TOPIC_OTHER_KEY);
  });

  it("counts a tag once per asset even if the row is duplicated", () => {
    const topics = deriveTopics([
      asset("a", [["object", "mat"], ["object", "mat"]]),
      asset("b", [["object", "mat"]]),
      asset("c", [["object", "solo"]]),
    ]);
    // Without per-asset de-dup, "mat" would count 3 of 3 tagged assets and be
    // skipped as ambient — sending a and b to Other instead of their topic.
    expect(topics.get("a")).toBe("mat");
    expect(topics.get("b")).toBe("mat");
  });

  it("is deterministic under input reordering", () => {
    const assets = [
      asset("a", [["event", "protest"], ["object", "flag"]]),
      asset("b", [["object", "flag"]]),
      asset("c", []),
      asset("d", [["scene", "street"], ["object", "flag"]]),
    ];
    const forward = deriveTopics(assets);
    const reversed = deriveTopics([...assets].reverse());
    for (const [id, topic] of forward) expect(reversed.get(id)).toBe(topic);
  });
});

const clustered = (id: string, label: string | null, tags: [string, string][] = []): TopicAsset => ({
  id,
  clusterLabel: label,
  tags: tags.map(([category, name]) => ({ category, name })),
});

describe("deriveTopics cluster labels (ADR 0028)", () => {
  it("a stored cluster label wins over the tag heuristic", () => {
    // Tags alone would pick "mat"; the cluster label overrides it.
    const topics = deriveTopics([
      clustered("a", "yoga · stretching", [["object", "mat"]]),
      clustered("b", "yoga · stretching", [["object", "mat"]]),
    ]);
    expect(topics.get("a")).toBe("yoga · stretching");
    expect(topics.get("b")).toBe("yoga · stretching");
  });

  it("a null or empty cluster label falls back to the tag heuristic", () => {
    const topics = deriveTopics([
      clustered("a", null, [["object", "mat"]]),
      clustered("b", "", [["object", "mat"]]),
      clustered("c", "   ", [["object", "mat"]]), // whitespace-only is not a label
    ]);
    expect(topics.get("a")).toBe("mat");
    expect(topics.get("b")).toBe("mat");
    expect(topics.get("c")).toBe("mat");
  });

  it("a clustered asset with no tags gets its label, not Unsorted", () => {
    const topics = deriveTopics([clustered("a", "protest", [])]);
    expect(topics.get("a")).toBe("protest");
  });

  it("an unclustered, untagged asset is still Unsorted", () => {
    const topics = deriveTopics([clustered("a", null, [])]);
    expect(topics.get("a")).toBe(UNSORTED_CLOUD_KEY);
  });

  it("cluster labels are never folded into Other, however many there are (ADR 0038)", () => {
    // 7 cluster labels against a cap of 6. The cap bounds the HEURISTIC's
    // sprawl — it is result-set-relative and can invent a topic per read — but
    // a stored cluster is bounded per workspace by the worker's own k, and
    // folding one discards the stable semantic home ADR 0028 exists to give a
    // photo. Worse, which clusters survived depended on which project you had
    // open, since the fold counts only the rows this read returned.
    const pad = (n: number) => `c${String(n).padStart(2, "0")}`;
    const assets: TopicAsset[] = [
      clustered("a0", pad(0)),
      clustered("a1", pad(0)),
      clustered("a2", pad(0)),
      ...Array.from({ length: TOPIC_CLOUD_CAP }, (_, i) => clustered(`s${i}`, pad(i + 1))),
    ];
    const topics = deriveTopics(assets);
    const named = new Set([...topics.values()].filter((t) => t !== TOPIC_OTHER_KEY && t !== UNSORTED_CLOUD_KEY));
    expect(named.size).toBe(TOPIC_CLOUD_CAP + 1);
    expect(topics.get(`s${TOPIC_CLOUD_CAP - 1}`)).toBe(pad(TOPIC_CLOUD_CAP));
    expect([...topics.values()]).not.toContain(TOPIC_OTHER_KEY);
  });

  it("still caps heuristic topics while cluster labels ride free beside them", () => {
    // Two clusters plus TOPIC_CLOUD_CAP + 1 distinct tag topics: every cluster
    // label survives, and exactly TOPIC_CLOUD_CAP tag topics do.
    const assets: TopicAsset[] = [
      clustered("k0", "kept-cluster-a"),
      clustered("k1", "kept-cluster-b"),
      ...Array.from({ length: TOPIC_CLOUD_CAP + 1 }, (_, i) =>
        asset(`t${i}`, [["event", `topic-${String(i).padStart(2, "0")}`]]),
      ),
    ];
    const topics = deriveTopics(assets);
    const named = [...topics.values()].filter((t) => t !== TOPIC_OTHER_KEY && t !== UNSORTED_CLOUD_KEY);
    expect(named).toContain("kept-cluster-a");
    expect(named).toContain("kept-cluster-b");
    const heuristicNames = new Set(named.filter((t) => t.startsWith("topic-")));
    expect(heuristicNames.size).toBe(TOPIC_CLOUD_CAP);
    expect([...topics.values()].filter((t) => t === TOPIC_OTHER_KEY)).toHaveLength(1);
  });

  it("is deterministic under reorder with mixed clustered and heuristic assets", () => {
    const assets = [
      clustered("a", "yoga", [["object", "mat"]]),
      asset("b", [["event", "protest"], ["object", "flag"]]),
      clustered("c", null, [["object", "flag"]]),
      asset("d", []),
    ];
    const forward = deriveTopics(assets);
    const reversed = deriveTopics([...assets].reverse());
    for (const [id, topic] of forward) expect(reversed.get(id)).toBe(topic);
  });
});

describe("deriveTopicAssignments (editable Topic read model)", () => {
  it("lets a manual topic win without erasing the AI baseline", () => {
    const assignment = deriveTopicAssignments([
      {
        id: "a",
        tags: [{ category: "object", name: "mat" }],
        autoClusterId: "auto-1",
        autoClusterLabel: "Yoga",
        manualClusterId: "manual-2",
        manualClusterLabel: "Client picks",
      },
    ]).get("a")!;

    expect(assignment).toEqual({
      autoClusterId: "auto-1",
      manualClusterId: "manual-2",
      autoTopicKey: clusterTopicKey("auto-1"),
      autoTopicLabel: "Yoga",
      topicId: "manual-2",
      topicKey: clusterTopicKey("manual-2"),
      label: "Client picks",
    });
  });

  it("retains a synthetic AI baseline for Return to AI when a heuristic asset is manually assigned", () => {
    const assignment = deriveTopicAssignments([
      {
        id: "a",
        tags: [{ category: "object", name: "mat" }],
        manualClusterId: "manual-1",
        manualClusterLabel: "Favorites",
      },
      asset("b", [["object", "mat"]]),
    ]).get("a")!;

    expect(assignment.autoClusterId).toBeNull();
    expect(assignment.autoTopicLabel).toBe("mat");
    expect(assignment.autoTopicKey).toBe(heuristicTopicKey("mat"));
    expect(assignment.topicId).toBe("manual-1");
    expect(assignment.topicKey).toBe(clusterTopicKey("manual-1"));
    expect(assignment.label).toBe("Favorites");
  });

  it("gives equal stored labels distinct identities when their cluster ids differ", () => {
    const assignments = deriveTopicAssignments([
      { id: "a", tags: [], autoClusterId: "cl-1", autoClusterLabel: "Yoga" },
      { id: "b", tags: [], autoClusterId: "cl-2", autoClusterLabel: "Yoga" },
    ]);

    expect(assignments.get("a")?.topicKey).toBe("cl-1");
    expect(assignments.get("b")?.topicKey).toBe("cl-2");
    expect(assignments.get("a")?.label).toBe(assignments.get("b")?.label);
  });

  it("uses stable system keys for Other and Unsorted", () => {
    const assignments = deriveTopicAssignments([
      asset("empty", []),
      asset("other", [["place", "kyiv"]]),
    ]);

    expect(assignments.get("empty")?.topicKey).toBe(heuristicTopicKey(UNSORTED_CLOUD_KEY));
    expect(assignments.get("other")?.topicKey).toBe(heuristicTopicKey(TOPIC_OTHER_KEY));
    expect(assignments.get("empty")?.topicId).toBeNull();
    expect(assignments.get("other")?.topicId).toBeNull();
  });
});
