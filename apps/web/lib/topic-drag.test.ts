import { describe, expect, it } from "vitest";
import type { CloudLayout, CloudNode } from "./layout";
import { committedTopicDropKey, topicDropTargetAt } from "./topic-drag";

function cloud(key: string, x: number, y: number, label = key): CloudNode {
  return {
    key,
    label,
    color: "#fff",
    count: 1,
    clusterId: key,
    labelX: x + 50,
    labelY: y,
    bx: x,
    by: y,
    bw: 100,
    bh: 80,
  };
}

function layout(clouds: CloudNode[]): CloudLayout {
  return {
    clouds,
    tiles: {},
    edges: [],
    tileCloud: { a: "one", b: "two" },
    bounds: { xl: 0, yt: 0, xr: 400, yb: 300 },
  };
}

describe("topicDropTargetAt", () => {
  it("treats another cloud's core as a semantic target", () => {
    const target = topicDropTargetAt(layout([cloud("one", 0, 80), cloud("two", 220, 80)]), { x: 250, y: 110 }, ["a"]);
    expect(target?.key).toBe("two");
  });

  it("does not reinterpret a drag inside its current cloud", () => {
    const target = topicDropTargetAt(layout([cloud("one", 0, 80)]), { x: 40, y: 110 }, ["a"]);
    expect(target).toBeNull();
  });

  it("prefers a label over an overlapping core", () => {
    const first = cloud("one", 0, 80);
    const second = cloud("two", 70, 120);
    const target = topicDropTargetAt(layout([first, second]), { x: second.labelX, y: second.labelY - 12 }, []);
    expect(target?.key).toBe("two");
  });

  it("ignores the blurred area outside the core and label", () => {
    const target = topicDropTargetAt(layout([cloud("one", 100, 100)]), { x: 20, y: 200 }, []);
    expect(target).toBeNull();
  });

  it("does not materialize a heuristic cloud by mutating its unselected members", () => {
    const heuristic = { ...cloud("heuristic:street", 100, 100, "street"), clusterId: null };
    const target = topicDropTargetAt(layout([heuristic]), { x: 140, y: 130 }, []);
    expect(target).toBeNull();
  });
});

describe("committedTopicDropKey", () => {
  it("commits an armed target only on pointerup, never pointercancel", () => {
    expect(committedTopicDropKey("pointerup", "topic-id")).toBe("topic-id");
    expect(committedTopicDropKey("pointercancel", "topic-id")).toBeNull();
  });
});
