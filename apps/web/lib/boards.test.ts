import { beforeEach, describe, expect, it } from "vitest";
import type { Board } from "@archivemind/shared";
import { BOARD_COLORS, clearLegacyBoards, nextBoardColor, readLegacyBoards, splitBoards } from "./boards";

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
  deletedAt: null,
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

/** The header and the Trash panel read one array (ADR 0044 as amended): the
 *  reader returns live and trashed rows together so the restore affordance is
 *  in the first paint. What that costs is exactly this split. */
describe("splitBoards", () => {
  it("keeps a live board out of the trash and vice versa", () => {
    const { live, trashed } = splitBoards([
      board({ id: "a" }),
      board({ id: "b", deletedAt: "2026-08-13T10:00:00Z" }),
    ]);
    expect(live.map((b) => b.id)).toEqual(["a"]);
    expect(trashed.map((b) => b.id)).toEqual(["b"]);
  });

  it("puts the newest deletion first — [0] is what one click restores", () => {
    const { trashed } = splitBoards([
      board({ id: "old", deletedAt: "2026-08-01T10:00:00Z" }),
      board({ id: "new", deletedAt: "2026-08-13T10:00:00Z" }),
      board({ id: "mid", deletedAt: "2026-08-07T10:00:00Z" }),
    ]);
    expect(trashed.map((b) => b.id)).toEqual(["new", "mid", "old"]);
  });

  it("treats a board with no timestamp as live — a chip can never vanish over a missing column", () => {
    const { live, trashed } = splitBoards([board({ id: "a", deletedAt: null })]);
    expect(live).toHaveLength(1);
    expect(trashed).toHaveLength(0);
  });

  it("preserves the reader's order among the live ones", () => {
    const { live } = splitBoards([
      board({ id: "a", sortOrder: 0 }),
      board({ id: "x", deletedAt: "2026-08-13T10:00:00Z" }),
      board({ id: "b", sortOrder: 1 }),
    ]);
    expect(live.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [board({ id: "a" }), board({ id: "b", deletedAt: "2026-08-13T10:00:00Z" })];
    splitBoards(input);
    expect(input.map((b) => b.id)).toEqual(["a", "b"]);
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
