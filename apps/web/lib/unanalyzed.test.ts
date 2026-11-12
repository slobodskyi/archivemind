import { describe, expect, it } from "vitest";
import type { Photo } from "@/types";
import { analyzeReadiness, unanalyzedInScope } from "./unanalyzed";
import { analyzableUploadIds } from "./upload-pill";

function photo(
  id: string,
  opts: { processed?: boolean; src?: string; source?: Photo["source"] } = {},
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
    tags: null,
    facts: [],
    time: "07-15 12:00",
    day: "Jul 15",
    group: "archive",
    country: "Ukraine",
    label: null,
    source: opts.source ?? "upload",
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

const NONE: ReadonlySet<string> = new Set();

describe("analyzeReadiness", () => {
  it("is processed, pending (no preview) or ready", () => {
    expect(analyzeReadiness({ processed: true, src: "x" })).toBe("processed");
    expect(analyzeReadiness({ processed: true, src: undefined })).toBe("processed");
    expect(analyzeReadiness({ processed: false, src: undefined })).toBe("pending");
    expect(analyzeReadiness({ processed: false, src: "x" })).toBe("ready");
  });
});

describe("unanalyzedInScope", () => {
  it("selects an unprocessed, drawn photo with a preview; a processed one only counts", () => {
    const r = unanalyzedInScope([photo("a"), photo("b", { processed: true })], { a: 1, b: 1 }, NONE);
    expect(r).toEqual({ ids: ["a"], hidden: 0, pending: 0, total: 2 });
  });

  it("counts a photo with no preview as pending, never selected", () => {
    const r = unanalyzedInScope([photo("a", { src: undefined })], null, NONE);
    expect(r).toEqual({ ids: [], hidden: 0, pending: 1, total: 1 });
  });

  it("counts a ready photo the canvas does not draw (collapsed folder) as hidden", () => {
    const r = unanalyzedInScope([photo("a"), photo("b")], { a: 1 }, NONE);
    expect(r).toEqual({ ids: ["a"], hidden: 1, pending: 0, total: 2 });
  });

  it("skips a photo already in a running job entirely", () => {
    const busy = new Set(["a", "b"]);
    const r = unanalyzedInScope([photo("a"), photo("b", { src: undefined }), photo("c")], { c: 1 }, busy);
    expect(r).toEqual({ ids: ["c"], hidden: 0, pending: 0, total: 3 });
  });

  it("ignores mock rows, total included", () => {
    const r = unanalyzedInScope([photo("m", { source: "icloud" }), photo("a")], null, NONE);
    expect(r).toEqual({ ids: ["a"], hidden: 0, pending: 0, total: 1 });
  });

  it("treats drawn = null as everything drawn", () => {
    expect(unanalyzedInScope([photo("a"), photo("b")], null, NONE).ids).toEqual(["a", "b"]);
  });

  it("reads drawn as a Record (activePositions) or a Set the same way", () => {
    const photos = [photo("a"), photo("b"), photo("c")];
    const asRecord = unanalyzedInScope(photos, { a: { x: 0 }, c: { x: 1 } }, NONE);
    const asSet = unanalyzedInScope(photos, new Set(["a", "c"]), NONE);
    expect(asRecord).toEqual(asSet);
    expect(asRecord.ids).toEqual(["a", "c"]);
  });

  it("keeps input order and is empty for no photos", () => {
    const r = unanalyzedInScope([photo("z"), photo("a"), photo("m")], null, NONE);
    expect(r.ids).toEqual(["z", "a", "m"]);
    expect(unanalyzedInScope([], null, NONE)).toEqual({ ids: [], hidden: 0, pending: 0, total: 0 });
  });
});

describe("one analyzable rule for both offers", () => {
  it("the upload pill and the panel intro pick the same photos from the same set", () => {
    // Real uploads, nothing hidden or busy — the case both offers cover.
    const photos = [
      photo("ready-1"),
      photo("done", { processed: true }),
      photo("no-preview", { src: undefined }),
      photo("done-no-preview", { processed: true, src: undefined }),
      photo("ready-2"),
    ];
    const pill = analyzableUploadIds(photos.map((p) => p.id), photos);
    const intro = unanalyzedInScope(photos, null, NONE).ids;
    expect(pill).toEqual(["ready-1", "ready-2"]);
    expect(intro).toEqual(pill);
  });
});
