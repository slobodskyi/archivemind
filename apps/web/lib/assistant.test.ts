import { describe, expect, it } from "vitest";
import type { AssetLabel, SearchParse } from "@archivemind/shared";
import type { ChatResult, Photo } from "@/types";
import {
  buildAssistantContext,
  resultActions,
  searchReply,
  starterSuggestions,
  topTags,
  type AssistantBoard,
  type AssistantContextInput,
} from "./assistant";

function photo(
  id: string,
  opts: { processed?: boolean; src?: string; tags?: string[] | null; label?: AssetLabel | null } = {},
): Photo {
  return {
    id,
    seed: id,
    w: 400,
    h: 300,
    x: 0,
    y: 0,
    filename: `${id}.jpg`,
    processed: opts.processed ?? false,
    status: "Likely",
    captionKey: null,
    captionStyle: "Agency",
    chip: null,
    tags: opts.tags ?? null,
    facts: [],
    time: "07-15 12:00",
    day: "Jul 15",
    group: "archive",
    country: "Ukraine",
    label: opts.label ?? null,
    source: "upload",
    folder: "Uploads",
    project: "",
    src: "src" in opts ? opts.src : `https://r2.example/${id}.webp`,
    exif: {
      camera: "—",
      lens: "—",
      dateTaken: "2026-07-15 12:00",
      gpsLat: null,
      gpsLon: null,
      gpsLabel: "",
      iso: 0,
      aperture: "—",
      shutter: "—",
      editedFields: [],
      takenAtIso: null,
    },
  };
}

function ctxOf(photos: Photo[], over: Partial<AssistantContextInput> = {}) {
  return buildAssistantContext({
    projectMode: true,
    view: "neural",
    canSwitchView: true,
    photos,
    visiblePhotos: photos,
    drawn: null,
    busy: new Set(),
    jobActive: false,
    boards: [],
    activeBoardId: null,
    labelFilter: null,
    selectedIds: [],
    ...over,
  });
}

const board = (id: string, assetIds: string[], name = id): AssistantBoard => ({ id, name, color: "red", assetIds });

const PARSE: SearchParse = {
  semantic_text: "dog",
  date_from: null,
  date_to: null,
  place_terms: [],
  tag_terms: [],
  camera_terms: [],
  iso_min: null,
  iso_max: null,
  aperture: null,
  kinds: [],
};

const hit = (assetId: string, tier: "strong" | "weak" = "strong"): ChatResult => ({
  assetId,
  filename: `${assetId}.jpg`,
  tier,
  matchedTags: [],
  matchedPlace: null,
  matchedText: false,
});

describe("buildAssistantContext", () => {
  it("counts only what the canvas draws — a collapsed folder's members are not visible", () => {
    const photos = [photo("a"), photo("b"), photo("c")];
    const ctx = ctxOf(photos, { drawn: { a: 1, b: 1 } });
    expect([...ctx.visibleIds]).toEqual(["a", "b"]);
    expect([...ctx.loadedIds]).toEqual(["a", "b", "c"]);
    expect(ctx.unanalyzed.ids).toEqual(["a", "b"]);
    expect(ctx.unanalyzed.hidden).toBe(1);
  });

  it("has no Workspaces outside a project, whatever it was handed", () => {
    const ctx = ctxOf([photo("a")], { projectMode: false, boards: [board("b1", ["a"])], activeBoardId: "b1" });
    expect(ctx.boards).toEqual([]);
    expect(ctx.activeBoardId).toBeNull();
  });
});

describe("topTags", () => {
  it("ranks by how many photos carry a tag, ties by name", () => {
    const photos = [{ tags: ["dog", "park"] }, { tags: ["dog", "beach"] }, { tags: null }];
    expect(topTags(photos)).toEqual(["dog", "beach", "park"]);
  });

  it("drops a near-universal tag once there are enough photos to tell", () => {
    const photos = [
      { tags: ["outdoor", "dog"] },
      { tags: ["outdoor", "dog"] },
      { tags: ["outdoor", "cat"] },
      { tags: ["outdoor", "cat"] },
      { tags: ["outdoor", "bird"] },
    ];
    expect(topTags(photos)).toEqual(["cat", "dog", "bird"]);
  });

  it("keeps the universal tags when they are all there is", () => {
    const photos = Array.from({ length: 5 }, () => ({ tags: ["outdoor"] }));
    expect(topTags(photos)).toEqual(["outdoor"]);
  });

  it("counts a tag once per photo", () => {
    expect(topTags([{ tags: ["dog", "dog"] }, { tags: ["cat"] }])).toEqual(["cat", "dog"]);
  });
});

describe("resultActions", () => {
  const photos = [photo("a"), photo("b"), photo("c")];

  it("acts on the results this canvas draws and counts the rest", () => {
    const ctx = ctxOf(photos);
    const a = resultActions(["a", "zzz", "b", "a"], ctx);
    expect(a.ids).toEqual(["a", "b"]);
    expect(a.outside).toBe(1);
    expect(a.bringIn).toBeNull();
    expect(a.canShare).toBe(true);
    expect(a.canTrash).toBe(true);
  });

  it("offers no Workspace, Share or Trash on the all-files canvas — the menu's own gate", () => {
    const a = resultActions(["a"], ctxOf(photos, { projectMode: false, boards: [board("b1", [])] }));
    expect(a.boards).toBeNull();
    expect(a.canShare).toBe(false);
    expect(a.canTrash).toBe(false);
    expect(a.ids).toEqual(["a"]);
  });

  it("says how many results each Workspace is still missing", () => {
    const ctx = ctxOf(photos, { boards: [board("b1", ["a"]), board("b2", ["a", "b"])] });
    expect(resultActions(["a", "b"], ctx).boards).toEqual([
      { id: "b1", name: "b1", color: "red", missing: 1 },
      { id: "b2", name: "b2", color: "red", missing: 0 },
    ]);
  });

  it("in an open Workspace, offers to bring in the results that sit outside it", () => {
    // The Workspace holds only `a`, so only `a` is drawn; `b` is loaded but out.
    const ctx = ctxOf(photos, {
      visiblePhotos: [photos[0]],
      boards: [board("b1", ["a"]), board("b2", [])],
      activeBoardId: "b1",
    });
    const a = resultActions(["a", "b", "zzz"], ctx);
    expect(a.ids).toEqual(["a"]);
    expect(a.outside).toBe(2);
    expect(a.bringIn).toEqual({ boardId: "b1", name: "b1", ids: ["b"] });
    // The open Workspace is not in its own "add to" list.
    expect(a.boards?.map((b) => b.id)).toEqual(["b2"]);
  });

  it("has nothing to share or trash when no result is drawn here", () => {
    const a = resultActions(["zzz"], ctxOf(photos));
    expect(a.ids).toEqual([]);
    expect(a.canShare).toBe(false);
    expect(a.canTrash).toBe(false);
  });
});

describe("searchReply", () => {
  it("offers to analyze instead of telling the user to, when nothing matched", () => {
    const photos = [photo("a"), photo("b"), photo("c", { processed: true, tags: ["dog"] })];
    const reply = searchReply(PARSE, [], ctxOf(photos));
    expect(reply.text).toBe(
      "No matches. 2 of 3 photos on this canvas aren't analyzed yet, so search can't see them.",
    );
    expect(reply.offers).toEqual([
      { label: "Analyze 2 photos…", action: { kind: "analyze", ids: ["a", "b"] }, tone: "ai" },
    ]);
  });

  it("keeps the grammar for a single unanalyzed photo", () => {
    const reply = searchReply(PARSE, [], ctxOf([photo("a")]));
    expect(reply.text).toBe("No matches. 1 of 1 photo on this canvas isn't analyzed yet, so search can't see it.");
    expect(reply.offers[0].label).toBe("Analyze 1 photo…");
  });

  it("suggests the archive's own tags when everything is analyzed and nothing matched", () => {
    const photos = [photo("a", { processed: true, tags: ["dog"] }), photo("b", { processed: true, tags: ["cat"] })];
    const reply = searchReply(PARSE, [], ctxOf(photos));
    expect(reply.text).toBe("No matches. Try different wording, or one of these.");
    expect(reply.offers).toEqual([
      { label: "cat", action: { kind: "search", query: "cat" } },
      { label: "dog", action: { kind: "search", query: "dog" } },
    ]);
  });

  it("says the canvas is empty rather than suggesting anything", () => {
    expect(searchReply(PARSE, [], ctxOf([]))).toEqual({
      text: "No matches. There are no photos on this canvas yet.",
      note: null,
      offers: [],
    });
  });

  it("does not offer a photo with no preview — the worker would skip it", () => {
    const reply = searchReply(PARSE, [], ctxOf([photo("a", { src: undefined })]));
    expect(reply.offers).toEqual([]);
  });

  it("reports matches, and still mentions what search could not see", () => {
    const photos = [photo("a", { processed: true }), photo("b")];
    const reply = searchReply(PARSE, [hit("a"), hit("x", "weak")], ctxOf(photos));
    expect(reply.text).toBe("1 best match — plus 1 more distant below. Tap a thumb to open it.");
    expect(reply.note).toBe("1 photo on this canvas isn't analyzed yet, so search can't see it.");
    expect(reply.offers.map((o) => o.action.kind)).toEqual(["analyze"]);
  });

  it("names only filters that actually applied", () => {
    const parsed: SearchParse = { ...PARSE, place_terms: ["kyiv"], date_from: "2026-06-01", date_to: "2026-06-30" };
    const results = [{ ...hit("a"), matchedTags: ["dog"], matchedText: true }];
    const reply = searchReply(parsed, results, ctxOf([photo("a", { processed: true })]));
    expect(reply.text).toBe(
      "1 best match (dates 2026-06-01 – 2026-06-30; place: kyiv; tagged: dog; in description). Tap a thumb to open it.",
    );
    expect(reply.note).toBeNull();
    expect(reply.offers).toEqual([]);
  });
});

describe("starterSuggestions", () => {
  it("leads with the one thing that helps when nothing is analyzed", () => {
    const s = starterSuggestions(ctxOf([photo("a"), photo("b")]));
    expect(s.note).toBe("Nothing here is analyzed yet — search only sees analyzed photos.");
    expect(s.offers).toEqual([
      { label: "Analyze 2 photos…", action: { kind: "analyze", ids: ["a", "b"] }, tone: "ai" },
    ]);
  });

  it("offers the archive's own tags as examples, and the untriaged pile when there is one", () => {
    const photos = [
      photo("a", { processed: true, tags: ["dog"], label: "red" }),
      photo("b", { processed: true, tags: ["dog", "park"] }),
    ];
    const s = starterSuggestions(ctxOf(photos));
    expect(s.note).toBeNull();
    expect(s.offers).toEqual([
      { label: "dog", action: { kind: "search", query: "dog" } },
      { label: "park", action: { kind: "search", query: "park" } },
      { label: "Show 1 unlabelled", action: { kind: "filter_label", filter: "none" } },
    ]);
  });

  it("does not offer the label filter when it would narrow nothing, or is already on", () => {
    const none = [photo("a", { processed: true }), photo("b", { processed: true })];
    expect(starterSuggestions(ctxOf(none)).offers).toEqual([]);
    const mixed = [photo("a", { processed: true, label: "red" }), photo("b", { processed: true })];
    expect(starterSuggestions(ctxOf(mixed, { labelFilter: "red" })).offers).toEqual([]);
  });

  it("says an empty canvas is empty", () => {
    expect(starterSuggestions(ctxOf([]))).toEqual({ note: "There are no photos on this canvas yet.", offers: [] });
  });

  it("is deterministic", () => {
    const photos = [photo("a", { processed: true, tags: ["b", "a", "c"] }), photo("b")];
    expect(starterSuggestions(ctxOf(photos))).toEqual(starterSuggestions(ctxOf(photos)));
  });
});
