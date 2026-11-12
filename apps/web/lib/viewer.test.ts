import { describe, expect, it } from "vitest";
import {
  clampCam,
  fitBox,
  fitCam,
  isZoomed,
  nativeZoom,
  resizeCam,
  stepSequence,
  swipeDirection,
  toggleZoom,
  viewerAfterRemoval,
  viewerInsets,
  viewerSequence,
  wheelZoomFactor,
  zoomAt,
  zoomPercent,
  zoomRange,
  type Insets,
  type Size,
} from "./viewer";

const stage: Size = { w: 1440, h: 900 };
const pad: Insets = viewerInsets(stage);
const range = zoomRange(3);

/** Where box point (cx, cy) lands on screen under a camera. */
function screen(cam: { z: number; tx: number; ty: number }, cx: number, cy: number) {
  return { x: cam.tx + cx * cam.z, y: cam.ty + cy * cam.z };
}

describe("fitBox", () => {
  it("contains a landscape photo without cropping, limited by width", () => {
    const box = fitBox({ w: 6000, h: 3000 }, stage, pad);
    expect(box.w).toBeCloseTo(1440 - 48);
    expect(box.h).toBeCloseTo((1440 - 48) / 2);
    expect(box.h).toBeLessThanOrEqual(900 - pad.top - pad.bottom);
  });

  it("contains a portrait photo, limited by height", () => {
    const box = fitBox({ w: 3000, h: 4500 }, stage, pad);
    expect(box.h).toBeCloseTo(900 - pad.top - pad.bottom);
    expect(box.w / box.h).toBeCloseTo(3000 / 4500);
  });

  it("keeps a panorama's aspect and fits its width", () => {
    const box = fitBox({ w: 12000, h: 2000 }, stage, pad);
    expect(box.w).toBeCloseTo(1440 - 48);
    expect(box.w / box.h).toBeCloseTo(6);
  });

  it("scales a small preview UP to fill the stage", () => {
    const box = fitBox({ w: 1024, h: 683 }, stage, pad);
    expect(box.w).toBeGreaterThan(1024);
  });
});

describe("fitCam", () => {
  it("centres the photo inside the padding — no bar covers a fitted photo", () => {
    const box = fitBox({ w: 3000, h: 4500 }, stage, pad);
    const cam = fitCam(box, stage, pad);
    expect(cam.z).toBe(1);
    expect(cam.ty).toBeGreaterThanOrEqual(pad.top - 0.001);
    expect(cam.ty + box.h).toBeLessThanOrEqual(stage.h - pad.bottom + 0.001);
    expect(cam.tx + box.w / 2).toBeCloseTo(pad.left + (stage.w - pad.left - pad.right) / 2);
  });

  it("is a fixed point of clampCam (fit never jumps when touched)", () => {
    const box = fitBox({ w: 4000, h: 3000 }, stage, pad);
    const cam = fitCam(box, stage, pad);
    expect(clampCam(cam, box, stage, pad, range)).toEqual(cam);
  });
});

describe("zoomAt", () => {
  const box = fitBox({ w: 6000, h: 4000 }, stage, pad);
  const fit = fitCam(box, stage, pad);

  it("keeps the photo point under the cursor under the cursor", () => {
    const px = 700;
    const py = 450;
    const cx = (px - fit.tx) / fit.z;
    const cy = (py - fit.ty) / fit.z;
    const cam = zoomAt(fit, 2.5, px, py, box, stage, pad, range);
    const p = screen(cam, cx, cy);
    expect(p.x).toBeCloseTo(px);
    expect(p.y).toBeCloseTo(py);
  });

  it("clamps the zoom into the range", () => {
    expect(zoomAt(fit, 0.2, 700, 450, box, stage, pad, range).z).toBe(range.min);
    expect(zoomAt(fit, 99, 700, 450, box, stage, pad, range).z).toBe(range.max);
  });

  it("never lets a zoomed photo's edge come inside the stage", () => {
    const cam = zoomAt(fit, 3, 5, 5, box, stage, pad, range);
    expect(cam.tx).toBeLessThanOrEqual(0);
    expect(cam.ty).toBeLessThanOrEqual(0);
    expect(cam.tx + box.w * cam.z).toBeGreaterThanOrEqual(stage.w);
    expect(cam.ty + box.h * cam.z).toBeGreaterThanOrEqual(stage.h);
  });
});

describe("clampCam", () => {
  it("does not let a fitted photo be dragged", () => {
    const box = fitBox({ w: 4000, h: 3000 }, stage, pad);
    const fit = fitCam(box, stage, pad);
    expect(clampCam({ ...fit, tx: fit.tx + 300, ty: fit.ty - 200 }, box, stage, pad)).toEqual(fit);
  });

  it("is continuous where the photo outgrows the stage", () => {
    const box = fitBox({ w: 4000, h: 3000 }, stage, pad);
    const at = (z: number) => clampCam({ z, tx: 0, ty: 0 }, box, stage, pad).ty;
    const zEdge = stage.h / box.h;
    expect(Math.abs(at(zEdge - 1e-6) - at(zEdge + 1e-6))).toBeLessThan(0.01);
  });
});

describe("toggleZoom", () => {
  const box = fitBox({ w: 6000, h: 4000 }, stage, pad);
  const fit = fitCam(box, stage, pad);

  it("goes from fit to the detail zoom at the clicked point, and back", () => {
    const zoomed = toggleZoom(fit, 400, 300, box, stage, pad, range);
    expect(zoomed.z).toBe(range.detail);
    expect(isZoomed(zoomed)).toBe(true);
    expect(toggleZoom(zoomed, 400, 300, box, stage, pad, range)).toEqual(fit);
  });
});

describe("native zoom", () => {
  it("is 1:1 device pixels — a 6000 px original on a 2x screen", () => {
    const box = { w: 1500, h: 1000 };
    expect(nativeZoom(box, { w: 6000, h: 4000 }, 2)).toBeCloseTo(2);
    expect(zoomPercent(2, 2)).toBe(100);
  });

  it("admits a preview is past 100% at fit on a retina screen", () => {
    const native = nativeZoom({ w: 1400, h: 933 }, { w: 1024, h: 683 }, 2);
    expect(zoomPercent(1, native)).toBeGreaterThan(100);
  });

  it("always offers a real magnification for detail", () => {
    expect(zoomRange(0.4).detail).toBe(2);
    expect(zoomRange(3.5).detail).toBe(3.5);
    expect(zoomRange(3.5).max).toBe(7);
    expect(zoomRange(0.4).max).toBe(4);
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in on a negative delta and out on a positive one", () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, false)).toBeLessThan(1);
  });

  it("treats a line-mode delta as 16 px", () => {
    expect(wheelZoomFactor(3, 1, false)).toBeCloseTo(wheelZoomFactor(48, 0, false));
  });

  it("gives a trackpad pinch a steeper curve", () => {
    expect(wheelZoomFactor(-5, 0, true)).toBeGreaterThan(wheelZoomFactor(-5, 0, false));
  });
});

describe("swipeDirection", () => {
  it("reads a decisive leftward drag as next and rightward as previous", () => {
    expect(swipeDirection(-120, 10)).toBe(1);
    expect(swipeDirection(120, -10)).toBe(-1);
  });

  it("ignores short or diagonal drags", () => {
    expect(swipeDirection(-40, 0)).toBe(0);
    expect(swipeDirection(-100, 90)).toBe(0);
  });
});

describe("resizeCam", () => {
  it("keeps the photo point at the stage centre through a resize", () => {
    const content = { w: 6000, h: 4000 };
    const box = fitBox(content, stage, pad);
    const cam = zoomAt(fitCam(box, stage, pad), 3, 500, 400, box, stage, pad, range);
    const u = (stage.w / 2 - cam.tx) / (box.w * cam.z);

    const big: Size = { w: 1920, h: 1080 };
    const bigPad = viewerInsets(big);
    const bigBox = fitBox(content, big, bigPad);
    const next = resizeCam(cam, { box, stage }, { box: bigBox, stage: big, pad: bigPad, range });
    expect(next.z).toBe(cam.z);
    expect((big.w / 2 - next.tx) / (bigBox.w * next.z)).toBeCloseTo(u);
  });
});

describe("viewerSequence", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("walks the whole order from the opened photo", () => {
    expect(viewerSequence(order, [], "c")).toEqual({ ids: order, start: "c" });
  });

  it("walks only the selection when two or more are selected and it opens on one of them", () => {
    expect(viewerSequence(order, ["d", "b"], "d")).toEqual({ ids: ["b", "d"], start: "d" });
    expect(viewerSequence(order, ["d", "b"], null)).toEqual({ ids: ["b", "d"], start: "b" });
  });

  it("walks the whole order when opened on a photo outside the selection", () => {
    expect(viewerSequence(order, ["d", "b"], "a")).toEqual({ ids: order, start: "a" });
  });

  it("opens a single selection with no explicit start", () => {
    expect(viewerSequence(order, ["c"], null)).toEqual({ ids: order, start: "c" });
  });

  it("opens nothing with no start and no selection", () => {
    expect(viewerSequence(order, [], null)).toBeNull();
  });

  it("still opens a start that the visible order does not contain", () => {
    expect(viewerSequence(order, [], "z")).toEqual({ ids: ["z", ...order], start: "z" });
  });
});

describe("stepSequence", () => {
  const ids = ["a", "b", "c"];

  it("steps both ways and wraps", () => {
    expect(stepSequence(ids, "b", 1)).toBe("c");
    expect(stepSequence(ids, "c", 1)).toBe("a");
    expect(stepSequence(ids, "a", -1)).toBe("c");
  });

  it("skips ids that are gone", () => {
    expect(stepSequence(ids, "a", 1, new Set(["a", "c"]))).toBe("c");
  });

  it("returns null when nothing else is left", () => {
    expect(stepSequence(["a"], "a", 1)).toBeNull();
    expect(stepSequence(ids, "x", 1)).toBeNull();
  });
});

describe("viewerAfterRemoval", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves forward past the removed photo", () => {
    expect(viewerAfterRemoval(ids, "b", new Set(["b"]))).toEqual({ ids: ["a", "c", "d"], current: "c" });
  });

  it("moves back from the end", () => {
    expect(viewerAfterRemoval(ids, "d", new Set(["d", "c"]))).toEqual({ ids: ["a", "b"], current: "b" });
  });

  it("closes when nothing is left", () => {
    expect(viewerAfterRemoval(["a"], "a", new Set(["a"]))).toEqual({ ids: [], current: null });
  });

  it("leaves the current photo alone when another one is removed", () => {
    expect(viewerAfterRemoval(ids, "a", new Set(["c"]))).toEqual({ ids: ["a", "b", "d"], current: "a" });
  });
});
