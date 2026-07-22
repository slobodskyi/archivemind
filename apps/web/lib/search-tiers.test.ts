import { describe, expect, it } from "vitest";
import { assignTiers, STRONG_COSINE_CAP, STRONG_DELTA } from "./search-tiers";

const row = (similarity: number, matchedTags: string[] = [], matchedPlace: string | null = null) => ({
  similarity,
  matchedTags,
  matchedPlace,
});

const tiers = (rows: ReturnType<typeof row>[]) => assignTiers(rows).map((r) => r.tier);

describe("assignTiers", () => {
  it("returns [] for no rows", () => {
    expect(assignTiers([])).toEqual([]);
  });

  it("a lone row is strong (trivially within delta of itself)", () => {
    expect(tiers([row(0.12)])).toEqual(["strong"]);
  });

  it("tag-matched rows are strong regardless of similarity", () => {
    expect(tiers([row(0.9), row(0.1, ["dog"])])).toEqual(["strong", "strong"]);
  });

  it("place-matched rows are strong regardless of similarity", () => {
    expect(tiers([row(0.9), row(0.1, [], "Kyiv, Ukraine")])).toEqual(["strong", "strong"]);
  });

  it("cosine-only rows split on the delta gap from the best similarity", () => {
    const rows = [row(0.5), row(0.5 - STRONG_DELTA), row(0.5 - STRONG_DELTA - 0.001)];
    expect(tiers(rows)).toEqual(["strong", "strong", "weak"]);
  });

  it("the gap is measured from the best similarity even when a filter-matched row holds it", () => {
    // Tag-matched row ranks first (SQL tag-first order) with the top similarity;
    // the cosine-only row 0.2 below it is weak, not dragged up by its own rank.
    expect(tiers([row(0.6, ["dog"]), row(0.4)])).toEqual(["strong", "weak"]);
  });

  it("caps cosine-only strong rows on a flat distribution", () => {
    const flat = Array.from({ length: 10 }, () => row(0.4));
    const got = tiers(flat);
    expect(got.filter((t) => t === "strong")).toHaveLength(STRONG_COSINE_CAP);
    expect(got.slice(0, STRONG_COSINE_CAP)).toEqual(Array(STRONG_COSINE_CAP).fill("strong"));
    expect(got.slice(STRONG_COSINE_CAP)).toEqual(Array(10 - STRONG_COSINE_CAP).fill("weak"));
  });

  it("filter-matched rows do not consume the cosine cap", () => {
    const rows = [
      ...Array.from({ length: 4 }, () => row(0.4, ["dog"])),
      ...Array.from({ length: STRONG_COSINE_CAP }, () => row(0.4)),
    ];
    expect(tiers(rows)).toEqual(Array(4 + STRONG_COSINE_CAP).fill("strong"));
  });

  it("preserves row order and payload", () => {
    const rows = [row(0.3, [], "Lviv"), row(0.9), row(0.2)];
    const got = assignTiers(rows);
    expect(got.map((r) => r.similarity)).toEqual([0.3, 0.9, 0.2]);
    expect(got[0].matchedPlace).toBe("Lviv");
  });
});
