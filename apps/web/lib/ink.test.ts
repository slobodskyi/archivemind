import { describe, expect, it } from "vitest";
import type { InkPoint } from "@archivemind/shared";
import {
  PRESSURE_BANDS,
  bandOf,
  bandWidth,
  distanceToStroke,
  pressureSegments,
  simplifyStroke,
  strokeBounds,
  strokePath,
  toRelative,
} from "./ink";

const pt = (x: number, y: number, p = 0.5): InkPoint => [x, y, p];

describe("simplifyStroke", () => {
  it("collapses a straight run to its endpoints", () => {
    const line = Array.from({ length: 20 }, (_, i) => pt(i, 0));
    expect(simplifyStroke(line)).toEqual([pt(0, 0), pt(19, 0)]);
  });

  it("keeps a corner", () => {
    const kept = simplifyStroke([pt(0, 0), pt(5, 0), pt(10, 0), pt(10, 10)]);
    expect(kept).toContainEqual(pt(10, 0));
    expect(kept[0]).toEqual(pt(0, 0));
    expect(kept.at(-1)).toEqual(pt(10, 10));
  });

  it("never drops the endpoints, and passes 2-point strokes through", () => {
    expect(simplifyStroke([pt(0, 0), pt(1, 1)])).toHaveLength(2);
    expect(simplifyStroke([pt(3, 4)])).toEqual([pt(3, 4)]);
  });

  // A stroke that returns to its start makes first==last, so the perpendicular
  // maths divides by a zero-length segment.
  it("survives a closed loop without producing NaN", () => {
    const loop = [pt(0, 0), pt(5, 5), pt(10, 0), pt(5, -5), pt(0, 0)];
    const out = simplifyStroke(loop);
    expect(out.length).toBeGreaterThan(2);
    expect(out.flat().every(Number.isFinite)).toBe(true);
  });

  // 600 samples is ~5 s of Pencil at 120 Hz. The point of simplifying is that
  // this does not become 600 stored points forever.
  it("cuts a realistic stroke down hard", () => {
    const wobbly = Array.from({ length: 600 }, (_, i) => pt(i * 0.4, Math.sin(i / 40) * 30));
    expect(simplifyStroke(wobbly).length).toBeLessThan(60);
  });
});

describe("strokeBounds + toRelative", () => {
  it("measures the box and rebases the points into it", () => {
    const points = [pt(100, 50), pt(140, 90), pt(120, 70)];
    const b = strokeBounds(points);
    expect(b).toEqual({ x: 100, y: 50, w: 40, h: 40 });
    expect(toRelative(points, b)).toEqual([pt(0, 0), pt(40, 40), pt(20, 20)]);
  });

  // A horizontal line and a dot are both legitimate strokes; the ink geometry
  // floor is 0 for exactly this reason.
  it("gives a flat stroke a zero-height box", () => {
    expect(strokeBounds([pt(0, 7), pt(10, 7)])).toEqual({ x: 0, y: 7, w: 10, h: 0 });
  });
});

describe("strokePath", () => {
  it("emits a dot as a zero-length segment so the linecap draws it", () => {
    expect(strokePath([pt(4, 6)])).toBe("M 4,6 L 4,6");
  });

  it("starts at the first point and emits a cubic per span", () => {
    const d = strokePath([pt(0, 0), pt(10, 0), pt(20, 0)]);
    expect(d.startsWith("M 0,0")).toBe(true);
    expect(d.match(/C /g)).toHaveLength(2);
  });

  it("is empty for no points, and never emits NaN", () => {
    expect(strokePath([])).toBe("");
    expect(strokePath([pt(0, 0), pt(1, 1), pt(2, 0)])).not.toContain("NaN");
  });
});

describe("pressure banding", () => {
  // 0 is "the device didn't say", not "press infinitely lightly" — a literal
  // reading would draw a zero-width line for every mouse stroke.
  it("treats an unreported pressure as a middling press", () => {
    expect(bandOf(0)).toBe(bandOf(0.5));
  });

  it("stays inside the band range at full pressure", () => {
    expect(bandOf(1)).toBe(PRESSURE_BANDS - 1);
    expect(bandOf(0.01)).toBe(0);
  });

  it("widens with the band and never reaches zero", () => {
    expect(bandWidth(PRESSURE_BANDS - 1, 4)).toBeGreaterThan(bandWidth(0, 4));
    expect(bandWidth(0, 0.5)).toBeGreaterThanOrEqual(0.5);
  });

  it("splits into runs that share a seam point, so the paths don't gap", () => {
    const segments = pressureSegments([pt(0, 0, 0.1), pt(1, 0, 0.1), pt(2, 0, 0.9), pt(3, 0, 0.9)]);
    expect(segments).toHaveLength(2);
    expect(segments[0].points.at(-1)).toEqual(segments[1].points[0]);
  });

  it("is one segment when the pressure never changes band", () => {
    expect(pressureSegments([pt(0, 0, 0.5), pt(1, 0, 0.52), pt(2, 0, 0.55)])).toHaveLength(1);
  });
});

describe("distanceToStroke", () => {
  const line = [pt(0, 0), pt(10, 0)];

  it("is zero on the stroke and the perpendicular gap beside it", () => {
    expect(distanceToStroke(line, 5, 0)).toBe(0);
    expect(distanceToStroke(line, 5, 3)).toBeCloseTo(3);
  });

  // Unclamped projection would measure to the infinite line and report 0 here,
  // so an eraser dragged along the same row would delete strokes it never met.
  it("measures to the endpoint past the end, not to the infinite line", () => {
    expect(distanceToStroke(line, 20, 0)).toBeCloseTo(10);
    expect(distanceToStroke(line, -5, 0)).toBeCloseTo(5);
  });

  it("handles a single-point stroke", () => {
    expect(distanceToStroke([pt(2, 2)], 2, 5)).toBeCloseTo(3);
  });
});
