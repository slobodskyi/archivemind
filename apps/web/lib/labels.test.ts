import { describe, expect, it } from "vitest";
import { ASSET_LABELS, DEFAULT_LABEL_NAMES } from "@archivemind/shared";
import type { Photo } from "@/types";
import { LABEL_COLORS, filterByLabel, labelCounts, resolveLabelNames } from "./labels";

function photo(id: string, label: Photo["label"] = null): Photo {
  return {
    id,
    seed: id,
    w: 400,
    h: 300,
    x: 0,
    y: 0,
    filename: `${id}.jpg`,
    processed: true,
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
    label,
    source: "upload",
    folder: "Uploads",
    project: "",
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

describe("the palette", () => {
  it("has exactly one colour per enum value, in the enum's order", () => {
    // The order is contractual: the swatch row, the number-key shortcuts (1–7)
    // and the LABELS view all index into it.
    expect(Object.keys(LABEL_COLORS)).toEqual([...ASSET_LABELS]);
    expect(Object.keys(DEFAULT_LABEL_NAMES)).toEqual([...ASSET_LABELS]);
  });
});

describe("resolveLabelNames", () => {
  it("is total: no overrides still names every colour", () => {
    expect(resolveLabelNames([])).toEqual(DEFAULT_LABEL_NAMES);
  });

  it("applies an override and leaves the rest at their defaults", () => {
    const names = resolveLabelNames([{ label: "red", name: "Rejected" }]);
    expect(names.red).toBe("Rejected");
    expect(names.green).toBe(DEFAULT_LABEL_NAMES.green);
  });

  it("ignores a blank override rather than rendering a nameless swatch", () => {
    expect(resolveLabelNames([{ label: "blue", name: "   " }]).blue).toBe(DEFAULT_LABEL_NAMES.blue);
  });

  it("ignores a colour it does not know (a value from a future migration)", () => {
    expect(() => resolveLabelNames([{ label: "chartreuse", name: "Nope" }])).not.toThrow();
    expect(resolveLabelNames([{ label: "chartreuse", name: "Nope" }])).toEqual(DEFAULT_LABEL_NAMES);
  });
});

describe("labelCounts", () => {
  it("counts every colour and the unlabelled remainder", () => {
    const counts = labelCounts([
      photo("a", "red"),
      photo("b", "red"),
      photo("c", "green"),
      photo("d"),
    ]);

    expect(counts.red).toBe(2);
    expect(counts.green).toBe(1);
    expect(counts.none).toBe(1);
    expect(counts.blue).toBe(0); // present, not undefined — the strip renders a 0
  });

  it("sums to the input size, so the strip can never imply a missing photo", () => {
    const photos = [photo("a", "purple"), photo("b"), photo("c", "gray")];
    const counts = labelCounts(photos);
    const total = ASSET_LABELS.reduce((sum, label) => sum + counts[label], counts.none);

    expect(total).toBe(photos.length);
  });
});

describe("filterByLabel", () => {
  const photos = [photo("a", "red"), photo("b"), photo("c", "red"), photo("d", "blue")];

  it("returns everything when no filter is set", () => {
    expect(filterByLabel(photos, null).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps only the given colour", () => {
    expect(filterByLabel(photos, "red").map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("treats 'none' as a real filter — the untriaged pile is the point", () => {
    expect(filterByLabel(photos, "none").map((p) => p.id)).toEqual(["b"]);
  });

  it("preserves input order, so the Canvas grid's index-based layout is unchanged", () => {
    const reversed = [...photos].reverse();
    expect(filterByLabel(reversed, null).map((p) => p.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("does not mutate its input", () => {
    const before = photos.map((p) => p.id);
    filterByLabel(photos, "red");
    expect(photos.map((p) => p.id)).toEqual(before);
  });
});
