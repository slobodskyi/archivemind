import { beforeEach, describe, expect, it } from "vitest";
import {
  CANVAS_STORE_VERSION,
  canvasArrangement,
  canvasStoreKey,
  dropLegacyNotes,
  readCanvasStore,
  switchCanvasScope,
  writeCanvasStore,
  type CanvasArrangement,
} from "./canvas-store";
import { EMPTY_GALLERY_OVERRIDES } from "./layout";

/** The suite runs in vitest's default `node` environment (this package ships no
 *  vitest config), where `window` is undefined and every reader short-circuits —
 *  so the assertions would pass vacuously. Same in-memory store `boards.test.ts`
 *  uses, for the same reason. */
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
};

const arrangement = (over: Partial<CanvasArrangement> = {}): CanvasArrangement => ({
  galleryOverrides: EMPTY_GALLERY_OVERRIDES,
  frames: [],
  groupGeom: {},
  tileZ: {},
  ...over,
});

const dragged = (x: number, y: number) => ({
  ...EMPTY_GALLERY_OVERRIDES,
  asset: { a1: { x, y } },
});

describe("canvasStoreKey", () => {
  it("keeps the pre-Workspace key for the project canvas", () => {
    // Back-compat, not cosmetics: every arrangement saved before workspaces
    // existed sits under this exact string, and changing it would silently reset
    // every project canvas in the wild to a fresh grid.
    expect(canvasStoreKey("p1", null)).toBe("archivemind:canvas:p1");
  });

  it("gives each Workspace its own key", () => {
    expect(canvasStoreKey("p1", "b1")).toBe("archivemind:canvas:p1:b:b1");
    expect(canvasStoreKey("p1", "b1")).not.toBe(canvasStoreKey("p1", "b2"));
    expect(canvasStoreKey("p1", "b1")).not.toBe(canvasStoreKey("p1", null));
  });

  it("scopes a Workspace to its project", () => {
    expect(canvasStoreKey("p1", "b1")).not.toBe(canvasStoreKey("p2", "b1"));
  });
});

describe("writeCanvasStore / readCanvasStore", () => {
  beforeEach(() => store.clear());

  it("round-trips an arrangement under its own scope", () => {
    writeCanvasStore(canvasStoreKey("p1", null), arrangement({ galleryOverrides: dragged(10, 20) }));
    const saved = readCanvasStore(canvasStoreKey("p1", null));
    expect(saved?.v).toBe(CANVAS_STORE_VERSION);
    expect(saved?.galleryOverrides?.asset).toEqual({ a1: { x: 10, y: 20 } });
  });

  it("leaves the project canvas untouched when a Workspace is arranged", () => {
    // The whole point of per-scope keys: dragging ten photos inside a workspace
    // must not move the same photos on the project canvas they were carved from.
    writeCanvasStore(canvasStoreKey("p1", null), arrangement({ galleryOverrides: dragged(10, 20) }));
    writeCanvasStore(canvasStoreKey("p1", "b1"), arrangement({ galleryOverrides: dragged(999, 999) }));

    expect(readCanvasStore(canvasStoreKey("p1", null))?.galleryOverrides?.asset).toEqual({
      a1: { x: 10, y: 20 },
    });
    expect(readCanvasStore(canvasStoreKey("p1", "b1"))?.galleryOverrides?.asset).toEqual({
      a1: { x: 999, y: 999 },
    });
  });

  it("reads nothing for a scope nobody has arranged", () => {
    writeCanvasStore(canvasStoreKey("p1", null), arrangement({ galleryOverrides: dragged(10, 20) }));
    expect(readCanvasStore(canvasStoreKey("p1", "b1"))).toBeNull();
  });

  it("discards a blob from an older layout generation", () => {
    store.set("archivemind:canvas:p1", JSON.stringify({ v: 1, galleryOverrides: dragged(10, 20) }));
    expect(readCanvasStore("archivemind:canvas:p1")).toBeNull();
  });

  it("discards a blob with no version at all", () => {
    store.set("archivemind:canvas:p1", JSON.stringify({ galleryOverrides: dragged(10, 20) }));
    expect(readCanvasStore("archivemind:canvas:p1")).toBeNull();
  });

  it("survives a hand-edited or truncated blob", () => {
    store.set("archivemind:canvas:p1", "{not json");
    expect(readCanvasStore("archivemind:canvas:p1")).toBeNull();
  });

  it("never writes the legacy note key back", () => {
    // ADR 0041: notes are rows now. A save that re-emitted them would resurrect
    // them on the next load, after the adoption already handed them over.
    store.set(
      "archivemind:canvas:p1",
      JSON.stringify({ v: CANVAS_STORE_VERSION, stickyNotes: [{ id: "n1" }] }),
    );
    writeCanvasStore("archivemind:canvas:p1", arrangement());
    expect(readCanvasStore("archivemind:canvas:p1")).not.toHaveProperty("stickyNotes");
  });

  it("stays quiet when storage refuses the write", () => {
    const real = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    };
    expect(() => writeCanvasStore("archivemind:canvas:p1", arrangement())).not.toThrow();
    (globalThis as { window?: unknown }).window = real;
  });
});

describe("canvasArrangement", () => {
  it("gives an unarranged scope a clean grid", () => {
    expect(canvasArrangement(null)).toEqual({
      galleryOverrides: EMPTY_GALLERY_OVERRIDES,
      frames: [],
      groupGeom: {},
      tileZ: {},
    });
  });

  it("builds fresh containers per call, so one scope can't mutate another", () => {
    const first = canvasArrangement(null);
    const second = canvasArrangement(null);
    expect(first.frames).not.toBe(second.frames);
    expect(first.groupGeom).not.toBe(second.groupGeom);
    expect(first.tileZ).not.toBe(second.tileZ);
  });

  it("fills in the buckets a save predates", () => {
    const loaded = canvasArrangement({ v: CANVAS_STORE_VERSION, galleryOverrides: { asset: { a1: { x: 1, y: 2 } } } });
    expect(loaded.galleryOverrides.asset).toEqual({ a1: { x: 1, y: 2 } });
    expect(loaded.galleryOverrides.topic).toEqual({});
    expect(loaded.galleryOverrides.timeline).toEqual({});
  });

  it("normalises a folder saved while expanded", () => {
    // `collapsed: false` is unreachable now; an old save carrying it would leave
    // an invisible drop target and members stranded beside their folder tile.
    const loaded = canvasArrangement({
      v: CANVAS_STORE_VERSION,
      groupGeom: { g1: { x: 4, y: 5, w: 300, h: 200, collapsed: false } },
    });
    expect(loaded.groupGeom.g1).toEqual({ x: 4, y: 5, w: 300, h: 200, collapsed: true });
  });

  it("keeps legacy frames verbatim", () => {
    const frames = [{ id: "f1", boardId: null, x: 0, y: 0, w: 10, h: 10, label: "A" }];
    expect(canvasArrangement({ v: CANVAS_STORE_VERSION, frames }).frames).toEqual(frames);
  });
});

describe("switchCanvasScope", () => {
  beforeEach(() => store.clear());

  const project = canvasStoreKey("p1", null);
  const board = canvasStoreKey("p1", "b1");
  const assetAt = (a: CanvasArrangement) => a.galleryOverrides.asset.a1;

  it("hands a never-arranged Workspace a clean grid, and keeps the project's own", () => {
    const opened = switchCanvasScope(project, board, arrangement({ galleryOverrides: dragged(10, 20) }));
    expect(assetAt(opened)).toBeUndefined();
    expect(readCanvasStore(project)?.galleryOverrides?.asset).toEqual({ a1: { x: 10, y: 20 } });
  });

  it("gives each scope its own coordinates across a round trip", () => {
    // The reported behaviour, start to finish: arrange the project canvas, open a
    // Workspace, arrange THAT, then go back. Before per-scope blobs the last drag
    // won and the project canvas came back rearranged.
    const openBoard = switchCanvasScope(project, board, arrangement({ galleryOverrides: dragged(10, 20) }));
    const backToProject = switchCanvasScope(board, project, {
      ...openBoard,
      galleryOverrides: dragged(999, 999),
    });
    expect(assetAt(backToProject)).toEqual({ x: 10, y: 20 });

    const reopenBoard = switchCanvasScope(project, board, backToProject);
    expect(assetAt(reopenBoard)).toEqual({ x: 999, y: 999 });
  });

  it("flushes an arrangement the debounce never got to", () => {
    // A drag, then a chip click inside 400 ms: the switch itself is the save.
    switchCanvasScope(project, board, arrangement({ galleryOverrides: dragged(7, 8) }));
    expect(readCanvasStore(project)?.galleryOverrides?.asset).toEqual({ a1: { x: 7, y: 8 } });
  });

  it("keeps each Workspace's folder boxes and stacking apart", () => {
    const inProject = arrangement({
      groupGeom: { g1: { x: 1, y: 1, w: 152, h: 118, collapsed: true } },
      tileZ: { a1: 3 },
    });
    const inBoard = switchCanvasScope(project, board, inProject);
    expect(inBoard.groupGeom).toEqual({});
    expect(inBoard.tileZ).toEqual({});
    expect(switchCanvasScope(board, project, inBoard).groupGeom.g1).toEqual({
      x: 1,
      y: 1,
      w: 152,
      h: 118,
      collapsed: true,
    });
  });

  it("keeps two Workspaces in the same project apart", () => {
    const one = canvasStoreKey("p1", "b1");
    const two = canvasStoreKey("p1", "b2");
    const inOne = arrangement({ galleryOverrides: dragged(1, 1) });
    expect(assetAt(switchCanvasScope(one, two, inOne))).toBeUndefined();
    expect(assetAt(switchCanvasScope(two, one, arrangement({ galleryOverrides: dragged(2, 2) })))).toEqual({
      x: 1,
      y: 1,
    });
  });
});

describe("dropLegacyNotes", () => {
  beforeEach(() => store.clear());

  it("removes the notes and keeps the arrangement", () => {
    store.set(
      "archivemind:canvas:p1",
      JSON.stringify({
        v: CANVAS_STORE_VERSION,
        galleryOverrides: dragged(10, 20),
        stickyNotes: [{ id: "n1", x: 0, y: 0, w: 1, h: 1, text: "hi", color: "#ffe066" }],
      }),
    );
    dropLegacyNotes("archivemind:canvas:p1");
    const saved = readCanvasStore("archivemind:canvas:p1");
    expect(saved).not.toHaveProperty("stickyNotes");
    expect(saved?.galleryOverrides?.asset).toEqual({ a1: { x: 10, y: 20 } });
  });

  it("does nothing for a scope with no blob", () => {
    expect(() => dropLegacyNotes("archivemind:canvas:nope")).not.toThrow();
    expect(store.size).toBe(0);
  });
});
