import { describe, expect, it } from "vitest";
import {
  applyMarkdownCommand,
  articleSectionHasContent,
  moveArticlePlacement,
  removeArticlePlacement,
  reorderArticlePlacement,
  type ArticleEditorSection,
} from "./content-editor";

function section(
  id: string,
  assetIds: string[] = [],
  overrides: Partial<ArticleEditorSection> = {},
): ArticleEditorSection {
  return {
    id,
    heading: "",
    body: "",
    assetIds,
    media: assetIds.map((assetId) => ({
      assetId,
      presentation: {
        width: "wide",
        alignment: "center",
        aspect: "original",
        fit: "cover",
        focalPoint: { x: 0.5, y: 0.5 },
      },
      caption: "",
      altText: "",
    })),
    ...overrides,
  };
}

describe("applyMarkdownCommand", () => {
  it("wraps and unwraps an inline selection without losing its range", () => {
    const wrapped = applyMarkdownCommand("A useful sentence", 2, 8, "bold");
    expect(wrapped).toEqual({
      value: "A **useful** sentence",
      selectionStart: 4,
      selectionEnd: 10,
    });

    expect(applyMarkdownCommand(wrapped.value, wrapped.selectionStart, wrapped.selectionEnd, "bold")).toEqual({
      value: "A useful sentence",
      selectionStart: 2,
      selectionEnd: 8,
    });
  });

  it("inserts useful placeholder text at an empty caret", () => {
    expect(applyMarkdownCommand("Start ", 6, 6, "italic")).toEqual({
      value: "Start _italic text_",
      selectionStart: 7,
      selectionEnd: 18,
    });
  });

  it("adds and removes prefixes for every selected line", () => {
    const bulleted = applyMarkdownCommand("First\nSecond\nThird", 2, 10, "bullet");
    expect(bulleted.value).toBe("- First\n- Second\nThird");
    expect(applyMarkdownCommand(bulleted.value, bulleted.selectionStart, bulleted.selectionEnd, "bullet").value).toBe(
      "First\nSecond\nThird",
    );
  });

  it("numbers selected lines in order", () => {
    expect(applyMarkdownCommand("One\nTwo", 0, 7, "numbered").value).toBe("1. One\n2. Two");
  });

  it("toggles quote and subheading line prefixes", () => {
    const quoted = applyMarkdownCommand("A point", 0, 7, "quote");
    expect(quoted.value).toBe("> A point");
    expect(applyMarkdownCommand(quoted.value, quoted.selectionStart, quoted.selectionEnd, "quote").value).toBe("A point");

    expect(applyMarkdownCommand("A detail", 0, 8, "heading3").value).toBe("### A detail");
  });

  it("creates a link and selects the URL for immediate replacement", () => {
    const edit = applyMarkdownCommand("Read this", 5, 9, "link");
    expect(edit.value).toBe("Read [this](https://)");
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe("https://");
  });
});

describe("article placement edits", () => {
  it("moves an image and its exact editorial settings between sections", () => {
    const source = section("source", ["cover", "detail"]);
    source.media[1] = {
      ...source.media[1],
      caption: "A retained caption",
      altText: "A retained description",
      presentation: {
        width: "small",
        alignment: "right",
        aspect: "portrait",
        fit: "cover",
        focalPoint: { x: 1, y: 0 },
      },
    };
    const target = section("target", ["closing"]);
    const sections = [source, target];

    const moved = moveArticlePlacement(sections, "source", "target", "detail", 0);

    expect(moved[0].assetIds).toEqual(["cover"]);
    expect(moved[0].media.map((item) => item.assetId)).toEqual(["cover"]);
    expect(moved[1].assetIds).toEqual(["detail", "closing"]);
    expect(moved[1].media.map((item) => item.assetId)).toEqual(["detail", "closing"]);
    expect(moved[1].media[0]).toEqual(source.media[1]);
    expect(sections[0].assetIds).toEqual(["cover", "detail"]);
  });

  it("does not move onto an existing placement and lose either layout", () => {
    const sections = [section("source", ["shared"]), section("target", ["shared"])];
    const moved = moveArticlePlacement(sections, "source", "target", "shared", 0);

    expect(moved).toBe(sections);
    expect(moved.map((item) => item.assetIds)).toEqual([["shared"], ["shared"]]);
  });

  it("reorders asset ids and presentation together, clamping to the end", () => {
    const sections = [section("story", ["one", "two", "three"])];
    sections[0].media[0].caption = "belongs to one";

    const reordered = reorderArticlePlacement(sections, "story", "one", 99);

    expect(reordered[0].assetIds).toEqual(["two", "three", "one"]);
    expect(reordered[0].media.map((item) => item.assetId)).toEqual(["two", "three", "one"]);
    expect(reordered[0].media[2].caption).toBe("belongs to one");
  });

  it("removes both halves of a placement and leaves unrelated sections intact", () => {
    const untouched = section("untouched", ["other"]);
    const sections = [section("story", ["one", "two"]), untouched];

    const removed = removeArticlePlacement(sections, "story", "one");

    expect(removed[0].assetIds).toEqual(["two"]);
    expect(removed[0].media.map((item) => item.assetId)).toEqual(["two"]);
    expect(removed[1]).toBe(untouched);
  });

  it("flags only sections containing human text or placed sources before deletion", () => {
    expect(articleSectionHasContent(section("empty", [], { heading: "  ", body: "\n" }))).toBe(false);
    expect(articleSectionHasContent(section("heading", [], { heading: "A heading" }))).toBe(true);
    expect(articleSectionHasContent(section("body", [], { body: "A paragraph" }))).toBe(true);
    expect(articleSectionHasContent(section("media", ["photo"]))).toBe(true);
  });
});
