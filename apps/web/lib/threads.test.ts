import { describe, expect, it } from "vitest";
import type { CanvasEdge } from "@archivemind/shared";
import { deriveThreads } from "./threads";

const asset = (id: string) => ({ kind: "asset", id }) as const;
const note = (id: string) => ({ kind: "annotation", id }) as const;

let n = 0;
const edge = (
  from: { kind: "asset" | "annotation"; id: string },
  to: { kind: "asset" | "annotation"; id: string },
): CanvasEdge => ({ id: `e${(n += 1)}`, boardId: "b1", from, to });

const board = (...ids: string[]) => new Set(ids);

describe("deriveThreads", () => {
  it("walks a chain following the drawn direction", () => {
    const edges = [edge(asset("a"), asset("b")), edge(asset("b"), asset("c"))];
    expect(deriveThreads(edges, board("a", "b", "c"), ["c", "b", "a"])).toEqual([["a", "b", "c"]]);
  });

  it("a chain drawn backwards still starts at its directed end", () => {
    // c→b, b→a: the only end that is a `from` of its edge is c.
    const edges = [edge(asset("c"), asset("b")), edge(asset("b"), asset("a"))];
    expect(deriveThreads(edges, board("a", "b", "c"), ["a", "b", "c"])).toEqual([["c", "b", "a"]]);
  });

  it("falls back to reading order when both ends (or neither) are directed", () => {
    // a→b, c→b: both ends are `from`s — the tie breaks on reading order.
    const edges = [edge(asset("a"), asset("b")), edge(asset("c"), asset("b"))];
    expect(deriveThreads(edges, board("a", "b", "c"), ["c", "a", "b"])).toEqual([["c", "b", "a"]]);
  });

  it("a branching component is not offered as a thread", () => {
    const edges = [
      edge(asset("hub"), asset("a")),
      edge(asset("hub"), asset("b")),
      edge(asset("hub"), asset("c")),
    ];
    expect(deriveThreads(edges, board("hub", "a", "b", "c"), ["hub", "a", "b", "c"])).toEqual([]);
  });

  it("a cycle has no ends and is excluded", () => {
    const edges = [
      edge(asset("a"), asset("b")),
      edge(asset("b"), asset("c")),
      edge(asset("c"), asset("a")),
    ];
    expect(deriveThreads(edges, board("a", "b", "c"), ["a", "b", "c"])).toEqual([]);
  });

  it("note wires never join a thread", () => {
    const edges = [
      edge(asset("a"), asset("b")),
      edge(asset("b"), note("n1")),
      edge(note("n1"), asset("c")),
    ];
    // Without the note bridge, c is unconnected — one thread of two.
    expect(deriveThreads(edges, board("a", "b", "c"), ["a", "b", "c"])).toEqual([["a", "b"]]);
  });

  it("an edge to a photo no longer on the board cannot weld threads together", () => {
    const edges = [
      edge(asset("a"), asset("gone")),
      edge(asset("gone"), asset("b")),
      edge(asset("b"), asset("c")),
    ];
    expect(deriveThreads(edges, board("a", "b", "c"), ["a", "b", "c"])).toEqual([["b", "c"]]);
  });

  it("multiple threads sort by their first photo's reading order", () => {
    const edges = [edge(asset("x"), asset("y")), edge(asset("p"), asset("q"))];
    const order = ["p", "q", "x", "y"];
    expect(deriveThreads(edges, board("x", "y", "p", "q"), order)).toEqual([
      ["p", "q"],
      ["x", "y"],
    ]);
  });

  it("caps a thread at 20 photos, matching the dialog's own slice", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `p${i}`);
    const edges = ids.slice(1).map((id, i) => edge(asset(ids[i]), asset(id)));
    const [thread] = deriveThreads(edges, board(...ids), ids);
    expect(thread).toHaveLength(20);
    expect(thread[0]).toBe("p0");
  });
});
