import { describe, expect, it } from "vitest";
import { CREDIT_COST, costUsdFor, creditsFor, USD_PER_UNIT } from "./usage";

describe("creditsFor", () => {
  it("charges one credit per AI action per photo", () => {
    expect(creditsFor("image_analyzed", 1)).toBe(1);
    expect(creditsFor("caption_generated", 120)).toBe(120);
  });

  it("does not charge for the embedding half of an analyze call", () => {
    // analyze writes two usage rows per photo. Charging both would silently
    // double every analysis the moment a limit is enforced.
    expect(creditsFor("embedding", 1)).toBe(0);
  });

  it("leaves search, export and ingest free", () => {
    expect(creditsFor("search_query", 50)).toBe(0);
    expect(creditsFor("export", 18)).toBe(0);
    expect(creditsFor("asset_ingested", 412)).toBe(0);
  });

  it("charges nothing for an event type it does not know", () => {
    // A new handler that forgets to declare itself must not invent a charge —
    // and must not reach through the prototype either.
    expect(creditsFor("some_future_event", 10)).toBe(0);
    expect(creditsFor("constructor", 10)).toBe(0);
    expect(creditsFor("toString", 10)).toBe(0);
  });
});

describe("costUsdFor", () => {
  it("prices the paid calls", () => {
    expect(costUsdFor("image_analyzed", 1)).toBeCloseTo(0.0004, 6);
    expect(costUsdFor("caption_generated", 10)).toBeCloseTo(0.003, 6);
  });

  it("rounds to the 6 decimals the column stores", () => {
    // numeric(10,6): a longer float would be rounded by Postgres anyway, and a
    // value that differs between the app and the row is a reconciliation bug.
    const value = costUsdFor("embedding", 7);
    expect(value).not.toBeNull();
    expect(Number.isInteger(value! * 1e6)).toBe(true);
  });

  it("returns null rather than a confident zero for unpriced events", () => {
    expect(costUsdFor("export", 18)).toBeNull();
    expect(costUsdFor("asset_ingested", 412)).toBeNull();
    expect(costUsdFor("some_future_event", 1)).toBeNull();
    expect(costUsdFor("constructor", 1)).toBeNull();
  });
});

describe("tables", () => {
  it("price and credit tables cover exactly the same events", () => {
    // A row in one and not the other means an action that either bills without
    // costing or costs without billing.
    expect(Object.keys(USD_PER_UNIT).sort()).toEqual(Object.keys(CREDIT_COST).sort());
  });

  it("every event that costs a credit also costs us money", () => {
    for (const [type, credits] of Object.entries(CREDIT_COST)) {
      if (credits > 0) expect(USD_PER_UNIT[type as keyof typeof USD_PER_UNIT]).toBeGreaterThan(0);
    }
  });
});
