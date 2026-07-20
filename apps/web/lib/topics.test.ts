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

  it("prefers event over scene over object, regardless of counts", () => {
    const topics = deriveTopics([
      asset("a", [["object", "mat"], ["scene", "studio"], ["event", "protest"]]),
      asset("b", [["object", "mat"]]),
      asset("c", [["object", "mat"]]),
    ]);
    // "mat" is shared by 3 assets, but the event tag still wins for `a`.
    expect(topics.get("a")).toBe("protest");
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
    expect(topics.get("d")).toBe(TOPIC_OTHER_KEY); // only the ambient tag → no viable topic
    expect(topics.get("e")).toBe("banner");
  });

  it("sends assets with no thematic-category tags to Other", () => {
    const topics = deriveTopics([
      asset("a", [["place", "kyiv"], ["attribute", "uniform"], ["other", "misc"]]),
      asset("b", [["object", "mat"]]),
    ]);
    expect(topics.get("a")).toBe(TOPIC_OTHER_KEY);
  });

  it("folds topics beyond the cloud cap into Other (smallest first)", () => {
    // TOPIC_CLOUD_CAP + 1 topics: t0 has 3 members, t1..tN have 1 each.
    const assets: TopicAsset[] = [
      asset("a0", [["object", "t0"]]),
      asset("a1", [["object", "t0"]]),
      asset("a2", [["object", "t0"]]),
      ...Array.from({ length: TOPIC_CLOUD_CAP }, (_, i) =>
        asset(`s${i}`, [["object", `t${i + 1}`]]),
      ),
    ];
    const topics = deriveTopics(assets);
    const named = new Set(
      [...topics.values()].filter((t) => t !== TOPIC_OTHER_KEY && t !== UNSORTED_CLOUD_KEY),
    );
    expect(named.size).toBe(TOPIC_CLOUD_CAP);
    expect(named.has("t0")).toBe(true);
    // The lexicographically-last singleton lost the tie-break and folded.
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
