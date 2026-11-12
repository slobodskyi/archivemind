import { describe, expect, it } from "vitest";
import {
  activeShareFilters,
  decodeShareCursor,
  encodeShareCursor,
  filteredShareTotal,
  shareAssetsHref,
  type ProjectShareFacets,
} from "./project-share-public";

const board = "66666666-6666-4666-8666-666666666666";
const facets: ProjectShareFacets = {
  boards: [{ id: board, name: "Port", color: "blue", count: 12 }],
  labels: [{ label: "red", count: 5 }],
  tags: [{ name: "harbour", count: 9 }],
};

describe("shareAssetsHref", () => {
  it("keeps the cursor opaque and puts each filter beside it", () => {
    const cursor = encodeShareCursor("2026-10-01T09:30:00.123456+00:00", board);
    const href = shareAssetsHref("tok", cursor, { board, label: "red", tag: "river bank" });
    const url = new URL(href, "http://x");

    expect(url.pathname).toBe("/s/tok/assets");
    expect(decodeShareCursor(url.searchParams.get("cursor") ?? "")).toEqual({
      sortAt: "2026-10-01T09:30:00.123456+00:00",
      id: board,
    });
    expect(url.searchParams.get("board")).toBe(board);
    expect(url.searchParams.get("label")).toBe("red");
    expect(url.searchParams.get("tag")).toBe("river bank");
  });

  it("asks for a first page with neither a cursor nor a filter", () => {
    expect(shareAssetsHref("tok", null)).toBe("/s/tok/assets");
    expect(shareAssetsHref("tok", null, { tag: "a&b" })).toBe("/s/tok/assets?tag=a%26b");
  });
});

describe("filteredShareTotal", () => {
  it("is the link's own count without a filter", () => {
    expect(activeShareFilters({})).toBe(0);
    expect(filteredShareTotal({}, facets, 40)).toBe(40);
  });

  it("is the facet's SQL count under one filter", () => {
    expect(filteredShareTotal({ board }, facets, 40)).toBe(12);
    expect(filteredShareTotal({ label: "red" }, facets, 40)).toBe(5);
    expect(filteredShareTotal({ tag: "harbour" }, facets, 40)).toBe(9);
  });

  it("claims no number it cannot back: combined filters, or a tag outside the top 40", () => {
    expect(activeShareFilters({ board, label: "red" })).toBe(2);
    expect(filteredShareTotal({ board, label: "red" }, facets, 40)).toBeNull();
    expect(filteredShareTotal({ tag: "rare" }, facets, 40)).toBeNull();
  });
});
