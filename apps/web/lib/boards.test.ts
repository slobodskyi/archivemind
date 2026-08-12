import { beforeEach, describe, expect, it } from "vitest";
import type { Board } from "@archivemind/shared";
import { BOARD_COLORS, clearLegacyBoards, nextBoardColor, readLegacyBoards } from "./boards";

/** The suite runs in vitest's default `node` environment (this package ships no
 *  vitest config), where `window` is undefined and the legacy reader
 *  short-circuits to `[]` — so every assertion would pass vacuously. A five-line
 *  in-memory store exercises the real branches without a jsdom dependency. */
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
};

const board = (over: Partial<Board> = {}): Board => ({
  id: "b1",
  projectId: "p1",
  name: "Pitch",
  color: "blue",
  sortOrder: 0,
  assetIds: [],
  ...over,
});

/** Workspaces live in the `boards` table now. What is left client-side is the
 *  colour rule and the one-time adoption of the blobs the pre-table build wrote
 *  — and the adoption half has to survive a blob it did not write, because a
 *  throw there takes the whole canvas down with it. */
describe("readLegacyBoards", () => {
  beforeEach(() => window.localStorage.clear());

  it("reads the shape the pre-table client saved", () => {
    window.localStorage.setItem(
      "archivemind:boards:p1",
      JSON.stringify([{ id: "x", name: "Pitch", color: "green", assetIds: ["a", "b"] }]),
    );
    expect(readLegacyBoards("p1")).toEqual([{ name: "Pitch", color: "green", assetIds: ["a", "b"] }]);
  });

  it("drops the client-side ownership lists — board_id on the row replaced them", () => {
    window.localStorage.setItem(
      "archivemind:boards:p1",
      JSON.stringify([{ id: "x", name: "P", color: "blue", assetIds: [], noteIds: ["n1"], frameIds: ["f1"] }]),
    );
    expect(readLegacyBoards("p1")[0]).toEqual({ name: "P", color: "blue", assetIds: [] });
  });

  it("keys by project", () => {
    window.localStorage.setItem("archivemind:boards:p1", JSON.stringify([{ name: "P", color: "blue", assetIds: [] }]));
    expect(readLegacyBoards("p2")).toEqual([]);
  });

  it("returns [] for an unknown project", () => {
    expect(readLegacyBoards("nope")).toEqual([]);
  });

  it("returns [] rather than throwing on unparseable JSON", () => {
    window.localStorage.setItem("archivemind:boards:p1", "{not json");
    expect(readLegacyBoards("p1")).toEqual([]);
  });

  it("returns [] when the stored value is not an array", () => {
    window.localStorage.setItem("archivemind:boards:p1", JSON.stringify({ id: "b1" }));
    expect(readLegacyBoards("p1")).toEqual([]);
  });

  it("drops malformed entries and keeps the well-formed ones", () => {
    window.localStorage.setItem(
      "archivemind:boards:p1",
      JSON.stringify([{ name: "P", color: "blue", assetIds: ["a"] }, { name: "Q" }, null]),
    );
    expect(readLegacyBoards("p1")).toEqual([{ name: "P", color: "blue", assetIds: ["a"] }]);
  });

  it("falls back to blue for a colour outside the seven", () => {
    window.localStorage.setItem(
      "archivemind:boards:p1",
      JSON.stringify([{ name: "P", color: "chartreuse", assetIds: [] }]),
    );
    expect(readLegacyBoards("p1")[0].color).toBe("blue");
  });

  it("keeps only string asset ids", () => {
    window.localStorage.setItem(
      "archivemind:boards:p1",
      JSON.stringify([{ name: "P", color: "blue", assetIds: ["a", 7, null, "b"] }]),
    );
    expect(readLegacyBoards("p1")[0].assetIds).toEqual(["a", "b"]);
  });

  it("clearLegacyBoards forgets only that project", () => {
    window.localStorage.setItem("archivemind:boards:p1", JSON.stringify([{ name: "P", color: "blue", assetIds: [] }]));
    window.localStorage.setItem("archivemind:boards:p2", JSON.stringify([{ name: "Q", color: "red", assetIds: [] }]));
    clearLegacyBoards("p1");
    expect(readLegacyBoards("p1")).toEqual([]);
    expect(readLegacyBoards("p2")).toHaveLength(1);
  });
});

describe("nextBoardColor", () => {
  it("gives the first unused colour", () => {
    expect(nextBoardColor([])).toBe(BOARD_COLORS[0]);
    expect(nextBoardColor([board({ color: BOARD_COLORS[0] })])).toBe(BOARD_COLORS[1]);
  });

  it("skips over gaps rather than counting", () => {
    const used = [BOARD_COLORS[0], BOARD_COLORS[2]].map((color, i) => board({ id: `b${i}`, color }));
    expect(nextBoardColor(used)).toBe(BOARD_COLORS[1]);
  });

  it("cycles once every colour is taken, so it always returns one", () => {
    const all = BOARD_COLORS.map((color, i) => board({ id: `b${i}`, color }));
    expect(BOARD_COLORS).toContain(nextBoardColor(all));
  });

  it("is deterministic — no Math.random on this path", () => {
    const existing = [board()];
    expect(nextBoardColor(existing)).toBe(nextBoardColor(existing));
  });
});
