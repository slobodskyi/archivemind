import { describe, expect, it } from "vitest";
import { CAPTION_PROMPTS } from "@archivemind/shared";
import { buildCaptionPrompt } from "./caption";

const emptyMeta = {
  taken_at: null,
  camera_make: null,
  camera_model: null,
  gps_label: null,
};

describe("buildCaptionPrompt", () => {
  it("carries the style template and target language", () => {
    const p = buildCaptionPrompt("agency", "uk", emptyMeta, []);
    expect(p).toContain(CAPTION_PROMPTS.agency);
    expect(p).toContain("Write it in Ukrainian.");
    expect(p).not.toContain("Known metadata"); // nothing known → no metadata block
  });

  it("includes only the metadata that exists", () => {
    const p = buildCaptionPrompt(
      "social",
      "en",
      { ...emptyMeta, taken_at: "2026-06-18T14:03:00Z", camera_make: "Nikon", gps_label: "Kyiv, Ukraine" },
      [],
    );
    expect(p).toContain("Taken: 2026-06-18");
    expect(p).toContain("Camera: Nikon");
    expect(p).toContain("Location: Kyiv, Ukraine");
    expect(p).not.toContain("Confirmed facts");
  });

  it("accepts a Date for taken_at (pg parses timestamptz into Date)", () => {
    const p = buildCaptionPrompt("archival", "en", { ...emptyMeta, taken_at: new Date("2026-06-18T14:03:00Z") }, []);
    expect(p).toContain("Taken: 2026-06-18");
  });

  it("joins confirmed facts and anchors the no-invention rule", () => {
    const p = buildCaptionPrompt("archival", "en", emptyMeta, ["rescue operation", "flooded street"]);
    expect(p).toContain("Confirmed facts: rescue operation · flooded street");
    expect(p).toContain("never invent beyond it");
  });
});
