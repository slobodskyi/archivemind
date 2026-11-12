import { describe, expect, it } from "vitest";
import { toCaptions, type CaptionDbRow } from "./caption-rows";

const row = (lang: CaptionDbRow["lang"], text: string): CaptionDbRow => ({
  id: `id-${lang}`,
  lang,
  style: "agency",
  text,
  is_edited: false,
});

describe("toCaptions", () => {
  it("maps en and uk rows", () => {
    const c = toCaptions([row("en", "Hello"), row("uk", "Привіт")]);
    expect(c.EN?.Agency?.text).toBe("Hello");
    expect(c.UK?.Agency?.text).toBe("Привіт");
  });

  it("does not display stored ru rows (kept in the database, just not shown)", () => {
    const c = toCaptions([row("en", "Hello"), row("ru", "Привет")]);
    expect(Object.keys(c)).toEqual(["EN"]);
    expect(JSON.stringify(c)).not.toContain("Привет");
  });
});
