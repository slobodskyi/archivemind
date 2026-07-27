import { describe, expect, it } from "vitest";
import type { Photo } from "@/types";
import { captionRows, captionStateFor, pdfPageCount, underLabel } from "./export-plan";

/** Only `captions` is read; the rest of Photo is irrelevant here. */
const withCaptions = (captions: Photo["captions"]): Pick<Photo, "captions"> => ({ captions });
const cap = (text: string) => ({ id: text, text, edited: false });

const EN_AGENCY = withCaptions({ EN: { Agency: cap("en agency") } });
const UK_SOCIAL = withCaptions({ UK: { Social: cap("uk social") } });
const UK_AGENCY = withCaptions({ UK: { Agency: cap("uk agency") } });

describe("captionRows", () => {
  it("flattens the UI-cased map into the worker's lowercase contract", () => {
    expect(captionRows(EN_AGENCY)).toEqual([{ lang: "en", style: "agency", text: "en agency" }]);
  });

  it("is empty for an unanalyzed photo and for an undefined one", () => {
    expect(captionRows(withCaptions(undefined))).toEqual([]);
    expect(captionRows(undefined)).toEqual([]);
  });

  it("drops rows with no text rather than passing empty strings through", () => {
    expect(captionRows(withCaptions({ EN: { Agency: cap("") } }))).toEqual([]);
  });
});

describe("captionStateFor — PDF", () => {
  const pdf = { isDoc: true, lang: "en", style: "agency" } as const;

  it("reports an exact hit", () => {
    expect(captionStateFor(EN_AGENCY, pdf)).toBe("exact");
  });

  it("reports a fallback when the resolver finds something else to print", () => {
    // uk/agency requested, only en/agency exists → English of the same style.
    expect(captionStateFor(EN_AGENCY, { ...pdf, lang: "uk" })).toBe("fallback");
  });

  it("reports NONE when a caption exists but nothing will actually print", () => {
    // The bug this function exists to kill: resolveCaptionText returns "" for an
    // `en` request against a UK-only archive, so "some caption exists" was
    // showing an amber "falls back to another one" dot above a blank page.
    expect(captionStateFor(UK_SOCIAL, pdf)).toBe("none");
    expect(captionStateFor(UK_AGENCY, pdf)).toBe("none");
  });

  it("reports none for a photo with no captions at all", () => {
    expect(captionStateFor(withCaptions(undefined), pdf)).toBe("none");
  });
});

describe("captionStateFor — CSV and ZIP", () => {
  const csv = { isDoc: false, lang: "en", style: "agency" } as const;

  it("matches on style across any language, because every language is a column", () => {
    expect(captionStateFor(UK_AGENCY, csv)).toBe("exact");
    expect(captionStateFor(EN_AGENCY, csv)).toBe("exact");
  });

  it("never reports a fallback — export-csv does an exact lookup and leaves the cell empty", () => {
    // The empty cell IS the deliverable: it is the "these still need Ukrainian"
    // list. Promising a fallback here would be promising the opposite.
    expect(captionStateFor(UK_SOCIAL, csv)).toBe("none");
  });

  it("ignores the language entirely", () => {
    expect(captionStateFor(UK_AGENCY, { ...csv, lang: "ru" })).toBe("exact");
  });
});

describe("underLabel", () => {
  it("calls include.title what it is — the filename", () => {
    // assets.title is written verbatim from the uploaded filename and there is
    // no rename anywhere in the product.
    expect(underLabel({ caption: true, title: true, exif: false })).toBe("filename + caption under each");
  });

  it("lists only what is on, in a stable order", () => {
    expect(underLabel({ caption: true, title: false, exif: true })).toBe("caption + EXIF under each");
    expect(underLabel({ caption: false, title: true, exif: false })).toBe("filename under each");
  });

  it("says photos only when nothing is on", () => {
    expect(underLabel({ caption: false, title: false, exif: false })).toBe("photos only");
  });
});

describe("pdfPageCount", () => {
  it("counts the cover, because the worker inserts a real page and numbers against it", () => {
    expect(pdfPageCount(3, false, "one_per_page")).toBe(3);
    expect(pdfPageCount(3, true, "one_per_page")).toBe(4);
  });

  it("refuses to guess for grid", () => {
    // `cols` is columns per ROW; rows-per-page varies with the include toggles,
    // so any number here would be fiction.
    expect(pdfPageCount(3, false, "grid")).toBeNull();
    expect(pdfPageCount(3, true, "grid")).toBeNull();
  });

  it("handles an empty run", () => {
    expect(pdfPageCount(0, false, "one_per_page")).toBe(0);
    expect(pdfPageCount(0, true, "one_per_page")).toBe(1);
  });
});
