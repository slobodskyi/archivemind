import { describe, expect, it } from "vitest";
import {
  CONTENT_GENERATION_MAX_ASSETS,
  buildContentGenerationPrompt,
  buildContentResponseSchema,
  contentGenerationRequestSchema,
  parseGeneratedDraft,
  type ContentGenerationRequest,
  type SourceAssetContext,
} from "./content-generation";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const articleRequest: ContentGenerationRequest = {
  boardId: id(100),
  sourceAssetIds: [id(1), id(2), id(3)],
  kind: "article",
  brief: "A reflective story about the selected evening photographs.",
  language: "uk",
  tone: "editorial",
  options: { length: "short", imageCount: 2 },
};

const carouselRequest: ContentGenerationRequest = {
  boardId: id(100),
  sourceAssetIds: [id(1), id(2), id(3)],
  kind: "instagram_carousel",
  brief: "A concise sequence about the city at night.",
  language: "en",
  tone: "social",
  options: { slideCount: 3, aspect: "4:5" },
};

const source = (assetId: string): SourceAssetContext => ({
  id: assetId,
  title: `Photo ${assetId}`,
  takenAt: "2026-08-01T20:00:00Z",
  location: "Kyiv, Ukraine",
  tags: ["street", "night"],
  description: "A machine description of people walking under street lights.",
  confirmedFacts: ["The photographer confirmed this was made during the evening walk."],
  editedCaptions: [{ language: "en", style: "social", text: "A quiet evening in the city." }],
});

describe("contentGenerationRequestSchema", () => {
  it("accepts the two explicit generation modes", () => {
    expect(contentGenerationRequestSchema.parse(articleRequest).kind).toBe("article");
    expect(contentGenerationRequestSchema.parse(carouselRequest).kind).toBe("instagram_carousel");
  });

  it("rejects duplicate source ids instead of silently changing their order", () => {
    expect(() =>
      contentGenerationRequestSchema.parse({ ...articleRequest, sourceAssetIds: [id(1), id(1)] }),
    ).toThrow(/unique/);
  });

  it("caps one model call and cannot request more images than it receives", () => {
    const tooMany = Array.from({ length: CONTENT_GENERATION_MAX_ASSETS + 1 }, (_, index) => id(index + 1));
    expect(() => contentGenerationRequestSchema.parse({ ...articleRequest, sourceAssetIds: tooMany })).toThrow();
    expect(() =>
      contentGenerationRequestSchema.parse({
        ...carouselRequest,
        sourceAssetIds: [id(1), id(2)],
        options: { slideCount: 3, aspect: "1:1" },
      }),
    ).toThrow(/cannot exceed/);
  });
});

describe("buildContentGenerationPrompt", () => {
  it("pins the evidence boundary and preserves the user's source order", () => {
    const sources = articleRequest.sourceAssetIds.map(source);
    const prompt = buildContentGenerationPrompt(articleRequest, sources);
    expect(prompt).toContain("confirmedFacts are the only sources");
    expect(prompt).toContain("description are machine-written visual hints");
    expect(prompt).toContain("exactly 2 unique source images");
    expect(prompt.indexOf(id(1))).toBeLessThan(prompt.indexOf(id(2)));
    expect(prompt.indexOf(id(2))).toBeLessThan(prompt.indexOf(id(3)));
  });

  it("refuses source context that no longer matches the authorized order", () => {
    expect(() =>
      buildContentGenerationPrompt(articleRequest, [source(id(2)), source(id(1)), source(id(3))]),
    ).toThrow(/order exactly/);
  });

  it("makes assetId required and slide count exact in Gemini's response schema", () => {
    const schema = buildContentResponseSchema(carouselRequest);
    const slides = schema.properties?.slides;
    expect(slides?.minItems).toBe("3");
    expect(slides?.maxItems).toBe("3");
    expect(slides?.items?.required).toContain("assetId");
  });
});

describe("parseGeneratedDraft", () => {
  it("accepts a structured article with only the requested image count", () => {
    const parsed = parseGeneratedDraft(
      JSON.stringify({
        kind: "article",
        title: "After dark",
        dek: "Three streets, one evening.",
        intro: "The city settles into a different rhythm after sunset.",
        sections: [
          { heading: "First light", body: "A beginning.", assetIds: [id(1)] },
          { heading: "The walk", body: "A continuation.", assetIds: [id(3)] },
        ],
        socialExcerpt: "A walk through the city after dark.",
      }),
      articleRequest,
    );
    expect(parsed.kind).toBe("article");
  });

  it("rejects a foreign or duplicated article image id", () => {
    const base = {
      kind: "article",
      title: "After dark",
      dek: "Three streets, one evening.",
      intro: "Intro.",
      socialExcerpt: "Excerpt.",
    };
    expect(() =>
      parseGeneratedDraft(
        JSON.stringify({
          ...base,
          sections: [{ heading: "Story", body: "Text.", assetIds: [id(1), id(999)] }],
        }),
        articleRequest,
      ),
    ).toThrow(/not allowed/);
    expect(() =>
      parseGeneratedDraft(
        JSON.stringify({
          ...base,
          sections: [{ heading: "Story", body: "Text.", assetIds: [id(1), id(1)] }],
        }),
        articleRequest,
      ),
    ).toThrow(/unique/);
  });

  it("requires one allowed asset id on every carousel slide", () => {
    const valid = {
      kind: "instagram_carousel",
      caption: "The city after dark.",
      slides: [
        { assetId: id(1), headline: "Night falls", body: "The streets change." },
        { assetId: id(2), headline: "Keep walking", body: "Small moments emerge." },
        { assetId: id(3), headline: "Look back", body: "The sequence closes." },
      ],
      hashtags: ["#night", "#photography"],
    };
    expect(parseGeneratedDraft(JSON.stringify(valid), carouselRequest).kind).toBe("instagram_carousel");
    expect(() =>
      parseGeneratedDraft(
        JSON.stringify({ ...valid, slides: [{ headline: "No source", body: "Invalid." }, ...valid.slides.slice(1)] }),
        carouselRequest,
      ),
    ).toThrow();
    expect(() =>
      parseGeneratedDraft(
        JSON.stringify({
          ...valid,
          slides: valid.slides.map((slide, index) => (index === 2 ? { ...slide, assetId: id(999) } : slide)),
        }),
        carouselRequest,
      ),
    ).toThrow(/not allowed/);
  });
});
