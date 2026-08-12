import { beforeEach, describe, expect, it } from "vitest";
import { BOARD_COLORS, loadBoards, nextBoardColor, saveBoards, type Board } from "./boards";

/** The suite runs in vitest's default `node` environment (this package ships no
 *  vitest config), where `window` is undefined and `loadBoards` short-circuits to
 *  `[]` — so every assertion below would pass vacuously. A five-line in-memory
 *  store is enough to exercise the real branches, and costs no jsdom dependency
 *  for one module's worth of `localStorage`. */
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
  name: "Pitch",
  color: "blue",
  assetIds: ["a", "b"],
  ...over,
});

/** `lib/boards` is storage + one colour rule, and the storage half is the part
 *  that has to survive a blob it did not write: a hand-edited entry, a shape
 *  from an older build, or private mode refusing to persist at all. A board
 *  that throws takes the whole canvas with it. */
describe("loadBoards", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips through saveBoards", () => {
    const boards = [board(), board({ id: "b2", name: "Edit", color: "green", assetIds: [] })];
    saveBoards("p1", boards);
    expect(loadBoards("p1")).toEqual(boards);
  });

  it("keys by project, so two projects never see each other's boards", () => {
    saveBoards("p1", [board()]);
    expect(loadBoards("p2")).toEqual([]);
  });

  it("returns [] for an unknown project", () => {
    expect(loadBoards("nope")).toEqual([]);
  });

  it("returns [] rather than throwing on unparseable JSON", () => {
    window.localStorage.setItem("archivemind:boards:p1", "{not json");
    expect(loadBoards("p1")).toEqual([]);
  });

  it("returns [] when the stored value is not an array", () => {
    window.localStorage.setItem("archivemind:boards:p1", JSON.stringify({ id: "b1" }));
    expect(loadBoards("p1")).toEqual([]);
  });

  it("drops malformed entries and keeps the well-formed ones", () => {
    window.localStorage.setItem(
      "archivemind:boards:p1",
      JSON.stringify([board(), { id: "b2" }, null, { id: "b3", name: "x", color: "red", assetIds: "nope" }]),
    );
    expect(loadBoards("p1")).toEqual([board()]);
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
