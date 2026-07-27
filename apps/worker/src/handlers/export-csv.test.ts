import { describe, expect, it } from "vitest";
import { CSV_HEADER, toCsv } from "./export-csv";

const BOM = "﻿";

describe("toCsv", () => {
  it("writes CRLF rows behind a UTF-8 BOM", () => {
    // Both are for Excel: without the BOM it decodes uk/ru captions as mojibake.
    const out = toCsv([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(out).toBe(`${BOM}a,b\r\n1,2\r\n`);
  });

  it("quotes only the fields that need it", () => {
    const out = toCsv([["plain", "has,comma", 'has"quote', "has\nnewline"]]);
    expect(out).toBe(`${BOM}plain,"has,comma","has""quote","has\nnewline"\r\n`);
  });

  it("keeps Cyrillic intact", () => {
    const out = toCsv([["Рятувальники на затопленій вулиці"]]);
    expect(out).toContain("Рятувальники на затопленій вулиці");
    // Round-trips through a Buffer the way the handler writes it.
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
  });

  it("handles an empty table and empty cells without collapsing columns", () => {
    expect(toCsv([])).toBe(`${BOM}\r\n`);
    expect(toCsv([["", "", "x"]])).toBe(`${BOM},,x\r\n`);
  });
});

describe("CSV_HEADER", () => {
  it("carries what a downstream consumer needs, including the fields the PDF drops", () => {
    // Tags were specified by TECH_SPEC §8.5 and never made it into the PDF; the
    // AI description and the full EXIF were never exported at all.
    for (const col of ["tags", "ai_description", "lens", "iso", "aperture", "shutter", "latitude", "longitude"]) {
      expect(CSV_HEADER).toContain(col);
    }
  });

  it("splits facts by review status rather than merging them", () => {
    // The whole reason facts left the PDF: a machine consumer must be able to
    // tell user-verified ground truth from unreviewed model output.
    expect(CSV_HEADER).toContain("facts_confirmed");
    expect(CSV_HEADER).toContain("facts_unreviewed");
    expect(CSV_HEADER).not.toContain("facts");
  });

  it("gives every caption language its own column", () => {
    expect(CSV_HEADER).toContain("caption_en");
    expect(CSV_HEADER).toContain("caption_uk");
    expect(CSV_HEADER).toContain("caption_ru");
    expect(CSV_HEADER).toContain("caption_style");
  });

  it("has no duplicate column names", () => {
    expect(new Set(CSV_HEADER).size).toBe(CSV_HEADER.length);
  });
});
