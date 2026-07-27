import { describe, expect, it } from "vitest";
import { MIN_IMG_H, fitScale, planPhotoPage, wrap, type Measure } from "./export";

/** Fixed-width stand-in for an embedded font: every glyph is 5pt at size 10, so
 *  widths scale linearly with the font size. Keeps the geometry assertions exact
 *  without loading Liberation Sans. */
const measure: Measure = (text, size) => text.length * 0.5 * size;

const A4 = { w: 595.28, h: 841.89 };
const CONTENT_W = A4.w - 84; // MARGIN 42 both sides

describe("wrap", () => {
  it("breaks on word boundaries and keeps every line inside the column", () => {
    const lines = wrap("alpha beta gamma delta epsilon zeta", measure, 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, 10)).toBeLessThanOrEqual(60);
    expect(lines.join(" ")).toBe("alpha beta gamma delta epsilon zeta");
  });

  it("hard-breaks a single token wider than the column", () => {
    // One 60-char token at 5pt/char = 300pt against a 50pt column: the old
    // word-boundary-only wrapper emitted it as one over-wide line drawn past
    // the margin.
    const lines = wrap("x".repeat(60), measure, 10, 50);
    expect(lines.length).toBe(6);
    for (const l of lines) expect(measure(l, 10)).toBeLessThanOrEqual(50);
    expect(lines.join("")).toBe("x".repeat(60));
  });

  it("preserves paragraph breaks and drops empty input", () => {
    expect(wrap("one\n\ntwo", measure, 10, 500)).toEqual(["one", "two"]);
    expect(wrap("", measure, 10, 500)).toEqual([]);
  });
});

describe("fitScale", () => {
  it("picks the limiting dimension", () => {
    expect(fitScale(1000, 500, 500, 500)).toBe(0.5); // width-bound
    expect(fitScale(500, 1000, 500, 500)).toBe(0.5); // height-bound
  });

  it("never returns a negative or NaN scale", () => {
    // A negative box used to flow straight into drawImage, which pdf-lib accepts
    // without validation and renders point-reflected off the page.
    expect(fitScale(1000, 500, 500, -200)).toBe(0);
    expect(fitScale(0, 0, 500, 500)).toBe(0);
  });
});

describe("planPhotoPage", () => {
  const plan = (text: { title?: string; caption?: string; meta?: string }) =>
    planPhotoPage(A4.w, A4.h, { title: "", caption: "", meta: "", ...text }, measure);

  it("gives the whole content box to the photo when there is no text", () => {
    const p = plan({});
    expect(p.textH).toBe(0);
    expect(p.imgAreaH).toBeCloseTo(A4.h - 84 - 16, 5);
    expect(p.captionTruncated).toBe(false);
  });

  it("takes the text block out of the image area", () => {
    const p = plan({ title: "IMG_4821.HEIC", caption: "A short caption." });
    expect(p.titleLines).toEqual(["IMG_4821.HEIC"]);
    expect(p.capLines).toEqual(["A short caption."]);
    expect(p.imgAreaH).toBeCloseTo(A4.h - 84 - p.textH - 16, 5);
    expect(p.imgAreaH).toBeLessThan(A4.h - 84 - 16);
  });

  it("keeps the photo at MIN_IMG_H and truncates the caption instead of going negative", () => {
    // ~12k characters: comfortably past the point where the old unclamped
    // arithmetic drove the remaining height below zero.
    const p = plan({ title: "T", caption: "word ".repeat(2400), meta: "Nikon · 2026-06-18 · Kyiv" });
    expect(p.captionTruncated).toBe(true);
    expect(p.imgAreaH).toBeGreaterThanOrEqual(MIN_IMG_H);
    expect(p.capLines.at(-1)?.endsWith("…")).toBe(true);
    // The whole block still fits above the bottom margin.
    expect(p.textH + MIN_IMG_H + 16).toBeLessThanOrEqual(A4.h - 84);
  });

  it("is stable across both page sizes and landscape", () => {
    for (const [w, h] of [
      [A4.w, A4.h],
      [A4.h, A4.w],
      [612, 792],
      [792, 612],
    ] as const) {
      const p = planPhotoPage(w, h, { title: "T", caption: "c ".repeat(4000), meta: "m" }, measure);
      expect(p.imgAreaH).toBeGreaterThanOrEqual(MIN_IMG_H);
      expect(p.textH + p.imgAreaH + 16).toBeLessThanOrEqual(h - 84 + 0.001);
    }
  });

  it("wraps a caption to the content width", () => {
    const p = plan({ caption: "z".repeat(400) });
    for (const l of p.capLines) expect(measure(l, 10)).toBeLessThanOrEqual(CONTENT_W);
  });
});
