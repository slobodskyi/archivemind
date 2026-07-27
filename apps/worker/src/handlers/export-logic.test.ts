import { describe, expect, it } from "vitest";
import {
  MIN_IMG_H,
  clampLines,
  coverLines,
  fitScale,
  footerCredit,
  planPhotoPage,
  truncateToWidth,
  wrap,
  type Measure,
} from "./export";

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

describe("clampLines", () => {
  it("passes short blocks through untouched", () => {
    expect(clampLines(["a", "b"], 2)).toEqual({ lines: ["a", "b"], truncated: false });
    expect(clampLines([], 2)).toEqual({ lines: [], truncated: false });
  });

  it("marks the cut with an ellipsis so a truncated caption is visibly cut", () => {
    // The grid used to .slice(0, 2), ending a caption mid-word with no signal.
    expect(clampLines(["one", "two", "three"], 2)).toEqual({ lines: ["one", "two…"], truncated: true });
  });

  it("handles a zero budget without producing a stray ellipsis", () => {
    expect(clampLines(["one"], 0)).toEqual({ lines: [], truncated: true });
  });
});

describe("truncateToWidth", () => {
  it("leaves a line that already fits", () => {
    expect(truncateToWidth("IMG_1.HEIC", measure, 8, 500)).toBe("IMG_1.HEIC");
    expect(truncateToWidth("", measure, 8, 10)).toBe("");
  });

  it("ellipsizes to the cell width, ellipsis included in the budget", () => {
    // measure: 0.5 * size per char → 4pt per char at size 8. 40pt = 10 chars.
    const out = truncateToWidth("ABCDEFGHIJKLMNOP", measure, 8, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(measure(out, 8)).toBeLessThanOrEqual(40);
  });

  it("returns empty rather than a bare ellipsis when nothing fits", () => {
    expect(truncateToWidth("ABC", measure, 8, 2)).toBe("");
  });
});

describe("footerCredit", () => {
  const ws = { creator: null, credit: null, copyright_notice: null, usage_terms: null };

  it("prefers the explicit credit line over the creator's name", () => {
    expect(footerCredit({ ...ws, creator: "O. Slobodskyi", credit: "Photo: O. S. / Agency" })).toBe(
      "Photo: O. S. / Agency",
    );
  });

  it("falls back to the creator, then to nothing", () => {
    expect(footerCredit({ ...ws, creator: "O. Slobodskyi" })).toBe("O. Slobodskyi");
    expect(footerCredit(ws)).toBe("");
    expect(footerCredit(null)).toBe("");
  });

  it("ignores whitespace-only values rather than printing a blank footer", () => {
    expect(footerCredit({ ...ws, credit: "   " })).toBe("");
  });
});

describe("coverLines", () => {
  const none = { creator: null, credit: null, copyright_notice: null, usage_terms: null };
  const range = { from: "2026-06-01T10:00:00.000Z", to: "2026-06-09T18:00:00.000Z" };

  it("leads with the count, pluralised", () => {
    expect(coverLines(1, { from: null, to: null }, null)[0]).toBe("1 photograph");
    expect(coverLines(24, { from: null, to: null }, null)[0]).toBe("24 photographs");
  });

  it("renders a date range as dates, not timestamps", () => {
    expect(coverLines(3, range, null)[1]).toBe("2026-06-01 — 2026-06-09");
  });

  it("collapses a single-day range to one date", () => {
    expect(coverLines(3, { from: range.from, to: range.from }, null)[1]).toBe("2026-06-01");
  });

  it("omits the date line entirely when nothing is dated", () => {
    expect(coverLines(3, { from: null, to: null }, null)).toEqual(["3 photographs"]);
  });

  it("appends the rights block in order", () => {
    const lines = coverLines(2, { from: null, to: null }, {
      creator: "O. Slobodskyi",
      credit: "Photo: O. S. / Agency",
      copyright_notice: "© 2026 O. Slobodskyi",
      usage_terms: "Editorial use only.",
    });
    expect(lines).toEqual([
      "2 photographs",
      "O. Slobodskyi",
      "Photo: O. S. / Agency",
      "© 2026 O. Slobodskyi",
      "Editorial use only.",
    ]);
  });

  it("does not print the same value twice when creator and credit agree", () => {
    const lines = coverLines(1, { from: null, to: null }, { ...none, creator: "O. S.", credit: "O. S." });
    expect(lines).toEqual(["1 photograph", "O. S."]);
  });

  it("skips blank rights fields", () => {
    expect(coverLines(1, { from: null, to: null }, { ...none, creator: "  ", usage_terms: "" })).toEqual([
      "1 photograph",
    ]);
  });
});
