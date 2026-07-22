import { describe, expect, it } from "vitest";
import {
  editRecipeSchema,
  inscribedCropForStraighten,
  isIdentityRecipe,
  resolveCropRect,
  workingDimensions,
  type EditRecipe,
} from "./index";

const base: EditRecipe = { rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null };

describe("editRecipeSchema", () => {
  it("fills Tier-0 defaults from an empty object", () => {
    expect(editRecipeSchema.parse({})).toEqual(base);
  });

  it("rejects a straighten past the clamp", () => {
    expect(editRecipeSchema.safeParse({ straighten: 46 }).success).toBe(false);
    expect(editRecipeSchema.safeParse({ straighten: -45 }).success).toBe(true);
  });

  it("rejects an out-of-bounds crop", () => {
    expect(editRecipeSchema.safeParse({ crop: { x: 0.6, y: 0, w: 0.6, h: 0.5 } }).success).toBe(false);
    expect(editRecipeSchema.safeParse({ crop: { x: 0, y: 0, w: 0, h: 0.5 } }).success).toBe(false);
    expect(editRecipeSchema.safeParse({ crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }).success).toBe(true);
  });

  it("only accepts the four quarter-turns", () => {
    expect(editRecipeSchema.safeParse({ rotate: 45 }).success).toBe(false);
    expect(editRecipeSchema.safeParse({ rotate: 270 }).success).toBe(true);
  });
});

describe("isIdentityRecipe", () => {
  it("is true only for the untouched recipe", () => {
    expect(isIdentityRecipe(base)).toBe(true);
    expect(isIdentityRecipe({ ...base, flipH: true })).toBe(false);
    expect(isIdentityRecipe({ ...base, rotate: 90 })).toBe(false);
    expect(isIdentityRecipe({ ...base, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toBe(false);
  });
});

describe("workingDimensions", () => {
  it("leaves size untouched for flips and 180°", () => {
    expect(workingDimensions(800, 600, { rotate: 0, straighten: 0 })).toEqual({ w: 800, h: 600 });
    expect(workingDimensions(800, 600, { rotate: 180, straighten: 0 })).toEqual({ w: 800, h: 600 });
  });

  it("swaps axes on a quarter-turn", () => {
    expect(workingDimensions(800, 600, { rotate: 90, straighten: 0 })).toEqual({ w: 600, h: 800 });
    expect(workingDimensions(800, 600, { rotate: 270, straighten: 0 })).toEqual({ w: 600, h: 800 });
  });

  it("grows the bounding box for a straighten (and is sign-symmetric)", () => {
    const pos = workingDimensions(800, 600, { rotate: 0, straighten: 10 });
    const neg = workingDimensions(800, 600, { rotate: 0, straighten: -10 });
    expect(pos).toEqual(neg);
    expect(pos.w).toBeGreaterThan(800);
    expect(pos.h).toBeGreaterThan(600);
  });
});

describe("resolveCropRect", () => {
  it("returns the whole frame for a null crop", () => {
    expect(resolveCropRect(1024, 768, null)).toEqual({ left: 0, top: 0, width: 1024, height: 768 });
  });

  it("maps a normalized crop to integer pixels", () => {
    expect(resolveCropRect(1000, 800, { x: 0.1, y: 0.25, w: 0.5, h: 0.5 })).toEqual({
      left: 100,
      top: 200,
      width: 500,
      height: 400,
    });
  });

  it("never overflows the source (rounding at the far edge is clamped)", () => {
    const r = resolveCropRect(100, 100, { x: 0.999, y: 0.999, w: 0.5, h: 0.5 });
    expect(r.left + r.width).toBeLessThanOrEqual(100);
    expect(r.top + r.height).toBeLessThanOrEqual(100);
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });
});

describe("inscribedCropForStraighten", () => {
  it("is the full frame with no straighten", () => {
    expect(inscribedCropForStraighten(800, 600, { rotate: 0, straighten: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  it("returns a centered, in-bounds sub-rect that survives schema validation", () => {
    const crop = inscribedCropForStraighten(800, 600, { rotate: 0, straighten: 12 });
    expect(crop.w).toBeGreaterThan(0);
    expect(crop.w).toBeLessThan(1);
    expect(crop.h).toBeLessThan(1);
    // centered
    expect(crop.x).toBeCloseTo((1 - crop.w) / 2, 6);
    expect(crop.y).toBeCloseTo((1 - crop.h) / 2, 6);
    // a real recipe carrying this crop must pass editRecipeSchema
    expect(editRecipeSchema.safeParse({ straighten: 12, crop }).success).toBe(true);
  });

  it("accounts for a quarter-turn when picking the inscribed rect", () => {
    const crop = inscribedCropForStraighten(800, 600, { rotate: 90, straighten: 8 });
    expect(crop.w).toBeGreaterThan(0);
    expect(crop.w).toBeLessThanOrEqual(1);
    expect(crop.h).toBeLessThanOrEqual(1);
  });
});
