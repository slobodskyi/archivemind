import { describe, expect, it } from "vitest";
import { UNSORTED_CLOUD_KEY } from "./layout";
import {
  deriveTopics,
  TOPIC_CLOUD_CAP,
  TOPIC_OTHER_KEY,
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
