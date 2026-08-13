import { describe, expect, it, vi } from "vitest";
import { contentGenerationResultSchema, draftFromGeneration, generationRequestBody, type CreateOutputInput } from "./content-generation-client";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

describe("content generation client bridge", () => {
  it("maps the persistence aspectRatio to the transport aspect field", () => {
    const input: CreateOutputInput = {
      kind: "instagram_carousel",
      sourceAssetIds: [id(1), id(2)],
      prompt: "Tell this story",
      audience: "Photographers",
      additionalInstructions: "Keep it concise",
      language: "en",
      tone: "social",
      aspectRatio: "4:5",
      slideCount: 2,
    };
    expect(generationRequestBody(id(20), input)).toMatchObject({
      boardId: id(20),
      brief: "Tell this story\n\nAudience: Photographers\n\nKeep it concise",
      options: { aspect: "4:5", slideCount: 2 },
    });
  });

  it("converts generated transport content into an ordered saved draft", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce(id(29))
      .mockReturnValueOnce(id(30))
      .mockReturnValueOnce(id(31)) });
    const input: CreateOutputInput = {
      kind: "article",
      sourceAssetIds: [id(1), id(2)],
      prompt: "A city story",
      audience: "Readers",
      additionalInstructions: "",
      language: "uk",
      tone: "editorial",
      length: "short",
      imageCount: 2,
    };
    const result = contentGenerationResultSchema.parse({
      model: "env-model",
      content: {
        kind: "article",
        title: "Після темряви",
        dek: "Два кадри.",
        intro: "Вступ.",
        sections: [
          { heading: "Початок", body: "Один.", assetIds: [id(1)] },
          { heading: "Фінал", body: "Два.", assetIds: [id(2)] },
        ],
        socialExcerpt: "Уривок.",
      },
    });

    const draft = draftFromGeneration(id(20), "Night", input, result);
    expect(draft.kind).toBe("article");
    expect(draft.sourceSnapshot.assetIds).toEqual([id(1), id(2)]);
    if (draft.kind === "article") expect(draft.content.sections.map((section) => section.id)).toEqual([id(29), id(30)]);
    vi.unstubAllGlobals();
  });
});
