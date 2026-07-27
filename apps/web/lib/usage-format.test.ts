import { describe, expect, it } from "vitest";
import {
  activityAmount,
  eventLabel,
  formatBytes,
  formatCount,
  formatDay,
  percentOf,
  segmentPercent,
  sourceLabel,
} from "./usage-format";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

describe("formatBytes", () => {
  it("distinguishes unmeasured from empty", () => {
    // The storage card shows both, and they mean different things: "we never
    // recorded this file's size" vs "there is nothing here".
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
  });

  it("scales 1024-based with one decimal below 100", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(KB)).toBe("1.0 KB");
    expect(formatBytes(1.5 * MB)).toBe("1.5 MB");
    expect(formatBytes(18.4 * GB)).toBe("18.4 GB");
  });

  it("drops the decimal at three digits, where it is noise", () => {
    expect(formatBytes(250 * GB)).toBe("250 GB");
  });

  it("never emits NaN for a broken value", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatCount", () => {
  it("groups thousands without Intl", () => {
    // Intl would format differently under a server locale than under the
    // browser's and trip hydration.
    expect(formatCount(12430)).toBe("12,430");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000000)).toBe("1,000,000");
    expect(formatCount(0)).toBe("0");
  });
});

describe("percentOf", () => {
  it("returns null when the plan has no limit", () => {
    // An unlimited plan must drop the meter, not render a full or empty bar.
    expect(percentOf(500, null)).toBeNull();
    expect(percentOf(500, 0)).toBeNull();
  });

  it("clamps to 0..100 so an over-quota workspace cannot overflow the bar", () => {
    expect(percentOf(50, 100)).toBe(50);
    expect(percentOf(300, 100)).toBe(100);
    expect(percentOf(-5, 100)).toBe(0);
  });
});

describe("segmentPercent", () => {
  it("measures a segment against the limit, so segments sum to the fill", () => {
    expect(segmentPercent(25, 100, 40)).toBe(25);
  });

  it("falls back to the total when there is no limit", () => {
    expect(segmentPercent(25, null, 50)).toBe(50);
  });

  it("is 0 rather than NaN on an empty archive", () => {
    expect(segmentPercent(0, null, 0)).toBe(0);
  });
});

describe("formatDay", () => {
  it("uses fixed English months and UTC", () => {
    expect(formatDay("2026-07-27T10:00:00Z")).toBe("27 Jul");
    expect(formatDay("2026-01-01T00:00:00Z")).toBe("1 Jan");
  });

  it("degrades on junk instead of throwing", () => {
    expect(formatDay(null)).toBe("—");
    expect(formatDay("not a date")).toBe("—");
  });
});

describe("labels", () => {
  it("names actions, not event types", () => {
    expect(eventLabel("caption_generated")).toBe("Captions");
    expect(eventLabel("asset_ingested")).toBe("Import");
  });

  it("passes an unknown type through rather than hiding the row", () => {
    expect(eventLabel("some_future_event")).toBe("some_future_event");
    expect(sourceLabel("icloud")).toBe("icloud");
  });

  it("names the real sources", () => {
    expect(sourceLabel("gdrive")).toBe("Google Drive");
    expect(sourceLabel("upload")).toBe("Uploads");
  });
});

describe("activityAmount", () => {
  it("measures each action in its own currency", () => {
    expect(activityAmount("asset_ingested", 412, 2 * GB)).toBe("2.0 GB");
    expect(activityAmount("image_analyzed", 310, 0)).toBe("310 cr");
    expect(activityAmount("search_query", 7, 0)).toBe("7 searches");
    expect(activityAmount("export", 18, 4 * MB)).toBe("18 items · 4.0 MB");
  });

  it("falls back to a file count for an import with no measured bytes", () => {
    expect(activityAmount("asset_ingested", 3, 0)).toBe("3 files");
  });

  it("returns null when there is nothing worth showing", () => {
    expect(activityAmount("image_analyzed", 0, 0)).toBeNull();
  });
});
