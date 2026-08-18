import { uuidSchema } from "@archivemind/shared";
import { z } from "zod";
import {
  createArticleDraft,
  createInstagramCarouselDraft,
  type ContentDraft,
} from "./content-drafts";

const assetIdSchema = uuidSchema;

const generatedArticleSchema = z.object({
  kind: z.literal("article"),
  title: z.string(),
  dek: z.string(),
  intro: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      body: z.string(),
      assetIds: z.array(assetIdSchema),
    }),
  ),
  socialExcerpt: z.string(),
});

const generatedCarouselSchema = z.object({
  kind: z.literal("instagram_carousel"),
  caption: z.string(),
  slides: z.array(
    z.object({
      assetId: assetIdSchema,
      headline: z.string(),
      body: z.string(),
    }),
  ),
  hashtags: z.array(z.string()),
});

export const contentGenerationResultSchema = z.object({
  content: z.discriminatedUnion("kind", [generatedArticleSchema, generatedCarouselSchema]),
  model: z.string().min(1),
});

export type ContentGenerationResult = z.infer<typeof contentGenerationResultSchema>;

export type CreateOutputInput =
  | {
      kind: "article";
      sourceAssetIds: string[];
      prompt: string;
      audience: string;
      additionalInstructions: string;
      language: "en" | "uk" | "ru";
      tone: "editorial" | "personal" | "social";
      length: "short" | "medium" | "long";
      imageCount: number;
    }
  | {
      kind: "instagram_carousel";
      sourceAssetIds: string[];
      prompt: string;
      audience: string;
      additionalInstructions: string;
      language: "en" | "uk" | "ru";
      tone: "editorial" | "personal" | "social";
      aspectRatio: "4:5" | "1:1";
      slideCount: number;
    };

function partId(prefix: "section" | "slide", index: number): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${index}`;
}

export function generationRequestBody(boardId: string, input: CreateOutputInput): Record<string, unknown> {
  const brief = [
    input.prompt,
    input.audience ? `Audience: ${input.audience}` : "",
    input.additionalInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
  const common = {
    boardId,
    sourceAssetIds: input.sourceAssetIds,
    brief,
    language: input.language,
    tone: input.tone,
  };
  return input.kind === "article"
    ? { ...common, kind: input.kind, options: { length: input.length, imageCount: input.imageCount } }
    : { ...common, kind: input.kind, options: { slideCount: input.slideCount, aspect: input.aspectRatio } };
}

/** Joins the transport response to the persistent browser-local draft model.
 * Keeping the conversion pure makes the request and saved shapes free to
 * evolve independently without leaking API-only discriminators into storage. */
export function draftFromGeneration(
  boardId: string,
  boardName: string,
  input: CreateOutputInput,
  result: ContentGenerationResult,
): ContentDraft {
  if (input.kind !== result.content.kind) throw new Error("Generated output kind does not match the request");
  const brief = {
    prompt: input.prompt,
    audience: input.audience,
    additionalInstructions: input.additionalInstructions,
    language: input.language,
    tone: input.tone,
  };
  if (input.kind === "article" && result.content.kind === "article") {
    return createArticleDraft({
      boardId,
      name: result.content.title || `${boardName} article`,
      sourceAssetIds: input.sourceAssetIds,
      brief,
      settings: { length: input.length, imageCount: input.imageCount },
      content: {
        title: result.content.title,
        dek: result.content.dek,
        intro: result.content.intro,
        sections: result.content.sections.map((section, index) => ({
          ...section,
          id: partId("section", index),
        })),
        socialExcerpt: result.content.socialExcerpt,
      },
    });
  }
  if (input.kind === "instagram_carousel" && result.content.kind === "instagram_carousel") {
    return createInstagramCarouselDraft({
      boardId,
      name: result.content.slides[0]?.headline || `${boardName} carousel`,
      sourceAssetIds: input.sourceAssetIds,
      brief,
      settings: { aspectRatio: input.aspectRatio, slideCount: input.slideCount },
      content: {
        caption: result.content.caption,
        slides: result.content.slides.map((slide, index) => ({
          ...slide,
          id: partId("slide", index),
        })),
        hashtags: result.content.hashtags,
      },
    });
  }
  throw new Error("Unsupported generated output");
}

/** The Create form's seed for "generate another version of this draft": the
 * same source snapshot, brief and settings the draft was made from. The saved
 * brief keeps `tone` as free text, so anything the form no longer offers falls
 * back to editorial. */
export function regenerationSeed(draft: ContentDraft): CreateOutputInput {
  const tone: CreateOutputInput["tone"] =
    draft.brief.tone === "personal" || draft.brief.tone === "social" ? draft.brief.tone : "editorial";
  const common = {
    sourceAssetIds: [...draft.sourceSnapshot.assetIds],
    prompt: draft.brief.prompt,
    audience: draft.brief.audience,
    additionalInstructions: draft.brief.additionalInstructions,
    language: draft.brief.language,
    tone,
  };
  return draft.kind === "article"
    ? { ...common, kind: draft.kind, length: draft.settings.length, imageCount: draft.settings.imageCount }
    : { ...common, kind: draft.kind, aspectRatio: draft.settings.aspectRatio, slideCount: draft.settings.slideCount };
}
