import { describe, expect, it } from "vitest";
import {
  UPLOAD_PILL_CTA_MS,
  UPLOAD_PILL_SUCCESS_MS,
  analyzableUploadIds,
  dockBottomFor,
  underUploadPill,
  uploadAnalyzeStatus,
  uploadPillDismiss,
  uploadPillHeld,
} from "./upload-pill";

const CLEAN = {
  done: true,
  failedCount: 0,
  skippedCount: 0,
  linkFailedCount: 0,
  errorCount: 0,
  pending: 0,
  analyzableCount: 0,
};

function photo(id: string, src: string | undefined, processed: boolean) {
  return { id, src, processed };
}

describe("uploadPillDismiss", () => {
  it("never auto-hides while the upload is in flight, even with failures", () => {
    expect(uploadPillDismiss({ ...CLEAN, done: false })).toEqual({ kind: "none" });
    expect(uploadPillDismiss({ ...CLEAN, done: false, failedCount: 2, errorCount: 1 }))
      .toEqual({ kind: "none" });
  });

  it("stays until closed when anything needs reading", () => {
    expect(uploadPillDismiss({ ...CLEAN, failedCount: 1 })).toEqual({ kind: "sticky" });
    expect(uploadPillDismiss({ ...CLEAN, skippedCount: 1 })).toEqual({ kind: "sticky" });
    expect(uploadPillDismiss({ ...CLEAN, linkFailedCount: 1 })).toEqual({ kind: "sticky" });
    expect(uploadPillDismiss({ ...CLEAN, errorCount: 1 })).toEqual({ kind: "sticky" });
  });

  it("sticky wins over pending and analyzable", () => {
    expect(uploadPillDismiss({ ...CLEAN, skippedCount: 1, pending: 3, analyzableCount: 2 }))
      .toEqual({ kind: "sticky" });
  });

  it("waits while a clean batch is still ingesting", () => {
    expect(uploadPillDismiss({ ...CLEAN, pending: 2, analyzableCount: 1 })).toEqual({ kind: "wait" });
  });

  it("gives the call to action the longer timer", () => {
    expect(uploadPillDismiss({ ...CLEAN, analyzableCount: 3 }))
      .toEqual({ kind: "auto", ms: UPLOAD_PILL_CTA_MS });
    expect(UPLOAD_PILL_CTA_MS).toBe(8000);
  });

  it("closes a plain success after the short timer, including an empty batch", () => {
    expect(uploadPillDismiss(CLEAN)).toEqual({ kind: "auto", ms: UPLOAD_PILL_SUCCESS_MS });
    expect(UPLOAD_PILL_SUCCESS_MS).toBe(4000);
  });
});

describe("analyzableUploadIds", () => {
  it("keeps only on-canvas photos with a preview that are not yet analyzed", () => {
    const photos = [
      photo("ready", "thumb.webp", false),
      photo("done", "thumb.webp", true),
      photo("no-preview", undefined, false),
    ];
    expect(analyzableUploadIds(["ready", "done", "no-preview", "merged-away"], photos))
      .toEqual(["ready"]);
  });

  it("dedupes repeated ids and keeps upload order", () => {
    const photos = [photo("a", "a.webp", false), photo("b", "b.webp", false), photo("c", "c.webp", false)];
    expect(analyzableUploadIds(["c", "a", "c", "b", "a"], photos)).toEqual(["c", "a", "b"]);
  });

  it("returns nothing for an empty batch", () => {
    expect(analyzableUploadIds([], [photo("a", "a.webp", false)])).toEqual([]);
  });
});

describe("uploadAnalyzeStatus", () => {
  it("a photo still processing is pending, not analyzable, even with a thumbnail", () => {
    expect(uploadAnalyzeStatus(
      ["a"],
      [photo("a", "a.webp", false)],
      [{ assetId: "a", stage: "processing" }],
    )).toEqual({ pending: 1, analyzable: [] });
  });

  it("counts uploading as pending; ready and error do not", () => {
    const photos = [photo("a", "a.webp", false), photo("b", "b.webp", false), photo("c", "c.webp", false)];
    expect(uploadAnalyzeStatus(["a", "b", "c"], photos, [
      { assetId: "a", stage: "uploading" },
      { assetId: "b", stage: "ready" },
      { assetId: "c", stage: "error" },
    ])).toEqual({ pending: 1, analyzable: ["b", "c"] });
  });

  it("ignores previews of other assets and previews with no asset id yet", () => {
    expect(uploadAnalyzeStatus(
      ["a"],
      [photo("a", "a.webp", false)],
      [
        { assetId: "other", stage: "processing" },
        { assetId: null, stage: "uploading" },
      ],
    )).toEqual({ pending: 0, analyzable: ["a"] });
  });

  it("splits a mixed batch", () => {
    const photos = [
      photo("ready", "r.webp", false),
      photo("analyzed", "x.webp", true),
      photo("busy", "b.webp", false),
    ];
    expect(uploadAnalyzeStatus(
      ["ready", "analyzed", "busy", "busy2", "merged"],
      photos,
      [
        { assetId: "busy", stage: "processing" },
        { assetId: "busy2", stage: "uploading" },
      ],
    )).toEqual({ pending: 2, analyzable: ["ready"] });
  });
});

describe("dockBottomFor", () => {
  it("falls back when there is no bottom chrome", () => {
    expect(dockBottomFor(800, [])).toBeNull();
  });

  it("docks 10 px above the highest bar", () => {
    expect(dockBottomFor(800, [738])).toBe(72); // ViewSwitcher only
    expect(dockBottomFor(800, [738, 686])).toBe(124); // switcher + sorting bar
    expect(dockBottomFor(800, [752])).toBe(58); // one 48 px bar at bottom 0
  });

  it("skips a panel too tall to dock above, and falls back when nothing leaves room", () => {
    expect(dockBottomFor(800, [738, 686, 120])).toBe(124);
    expect(dockBottomFor(800, [100])).toBeNull();
  });

  it("ignores non-finite tops and tops at or below the viewport edge", () => {
    expect(dockBottomFor(800, [Number.NaN, 800, 900, Number.POSITIVE_INFINITY])).toBeNull();
    expect(dockBottomFor(800, [Number.NaN, 700])).toBe(110);
  });

  it("honours custom gap and minimum room", () => {
    expect(dockBottomFor(800, [700], 20)).toBe(120);
    expect(dockBottomFor(800, [300], 10, 400)).toBeNull();
    expect(dockBottomFor(800, [300], 10, 200)).toBe(510);
  });
});

describe("underUploadPill", () => {
  it("counts chrome under the centred pill and skips a panel beside it", () => {
    // 1280 wide: the pill spans 430–850. The Map stack sits at 16–284.
    expect(underUploadPill(1280, { left: 16, right: 284 })).toBe(false);
    expect(underUploadPill(1280, { left: 500, right: 780 })).toBe(true); // centred bar
    expect(underUploadPill(1280, { left: 840, right: 900 })).toBe(true); // clips the edge
    expect(underUploadPill(1280, { left: 850, right: 900 })).toBe(false); // only touches it
  });

  it("on a phone the pill spans the width, so a side panel is under it", () => {
    // 375 wide: the pill spans 8–367.
    expect(underUploadPill(375, { left: 16, right: 284 })).toBe(true);
    expect(underUploadPill(375, { left: 0, right: 8 })).toBe(false);
  });
});

describe("uploadPillHeld", () => {
  it("never holds while there is no summary", () => {
    expect(uploadPillHeld({ hover: true, focusSeq: 1 }, null)).toBe(false);
  });

  it("keeps a resting pointer's hover across a new summary", () => {
    // Pointer entered over the progress pill / the Retry button (seq 1), and
    // the batch settled as seq 2 with no new pointerenter.
    expect(uploadPillHeld({ hover: true, focusSeq: null }, 2)).toBe(true);
    expect(uploadPillHeld({ hover: false, focusSeq: null }, 2)).toBe(false);
  });

  it("drops a focus recorded against an earlier summary", () => {
    expect(uploadPillHeld({ hover: false, focusSeq: 2 }, 2)).toBe(true);
    expect(uploadPillHeld({ hover: false, focusSeq: 1 }, 2)).toBe(false);
  });
});
