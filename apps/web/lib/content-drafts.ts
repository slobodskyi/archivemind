import { z } from "zod";

/** Browser-local output drafts for one Workspace (a `board` in code).
 *
 * A Workspace remains the source set. A draft takes an explicit snapshot of
 * that set, then owns its own order and text. This is what lets adding a photo
 * to the Workspace produce a visible "sources changed" state instead of
 * silently rewriting a publication that may already have manual edits.
 *
 * Drafts are intentionally local for the first Output MVP. The schemas below
 * keep that temporary store honest and give a later server-backed version one
 * domain shape to adopt. */

const STORE_PREFIX = "archivemind:content-drafts:v1:";
const STORE_SCHEMA_VERSION = 1 as const;

const idSchema = z.string().trim().min(1).max(200);
const shortTextSchema = z.string().trim().max(500);
const longTextSchema = z.string().max(50_000);
const timestampSchema = z.string().datetime({ offset: true });

const uniqueIdsSchema = z
  .array(idSchema)
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, "Asset ids must be unique");

export const contentDraftBriefSchema = z.object({
  /** The answer to "What should this material be about?" */
  prompt: z.string().trim().max(4_000).default(""),
  audience: shortTextSchema.default(""),
  language: z.enum(["en", "uk", "ru"]).default("en"),
  /** Free text on purpose: presets can fill it without constraining the user. */
  tone: shortTextSchema.default(""),
  additionalInstructions: z.string().trim().max(4_000).default(""),
});

export type ContentDraftBrief = z.infer<typeof contentDraftBriefSchema>;

export const draftSourceSnapshotSchema = z.object({
  assetIds: uniqueIdsSchema.min(1),
  capturedAt: timestampSchema,
});

export type DraftSourceSnapshot = z.infer<typeof draftSourceSnapshotSchema>;

export const articleDraftSettingsSchema = z.object({
  length: z.enum(["short", "medium", "long"]).default("medium"),
  imageCount: z.number().int().min(0).max(100).default(5),
});

export type ArticleDraftSettings = z.infer<typeof articleDraftSettingsSchema>;

export const articleMediaPresentationSchema = z.object({
  /** Relative to the article measure. Alignment only changes non-full media. */
  width: z.enum(["small", "medium", "wide", "full"]).default("wide"),
  alignment: z.enum(["left", "center", "right"]).default("center"),
  /** `original` never forces a crop; the other values define the media frame. */
  aspect: z.enum(["original", "landscape", "portrait", "square"]).default("original"),
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Normalized coordinates survive preview-size and eventual renderer changes. */
  focalPoint: z
    .object({
      x: z.number().min(0).max(1).default(0.5),
      y: z.number().min(0).max(1).default(0.5),
    })
    .prefault({}),
});

export type ArticleMediaPresentation = z.infer<typeof articleMediaPresentationSchema>;

export const DEFAULT_ARTICLE_MEDIA_PRESENTATION: Readonly<ArticleMediaPresentation> = {
  width: "wide",
  alignment: "center",
  aspect: "original",
  fit: "cover",
  focalPoint: { x: 0.5, y: 0.5 },
};

export const articleDraftMediaSchema = z.object({
  assetId: idSchema,
  presentation: articleMediaPresentationSchema.prefault({}),
  /** Editorial caption and accessible description are independent. */
  caption: z.string().max(2_000).default(""),
  altText: z.string().trim().max(1_000).default(""),
});

export type ArticleDraftMedia = z.infer<typeof articleDraftMediaSchema>;

export function createDefaultArticleMedia(assetId: string): ArticleDraftMedia {
  return articleDraftMediaSchema.parse({ assetId });
}

const articleDraftSectionSchema = z
  .object({
    id: idSchema,
    heading: z.string().trim().max(300).default(""),
    /** Markdown-ish plain text; the editor can stay block-model-free. */
    body: longTextSchema.default(""),
    /** Kept as the authoritative order and generation contract. */
    assetIds: uniqueIdsSchema.default([]),
    /** Presentation is local editorial state; Gemini need not invent layout. */
    media: z
      .array(articleDraftMediaSchema)
      .max(500)
      .refine((media) => new Set(media.map((item) => item.assetId)).size === media.length, {
        message: "Media asset ids must be unique",
      })
      .default([]),
  })
  .superRefine((section, context) => {
    const assetIds = new Set(section.assetIds);
    section.media.forEach((item, index) => {
      if (!assetIds.has(item.assetId)) {
        context.addIssue({
          code: "custom",
          message: `Media asset ${item.assetId} is not in the section`,
          path: ["media", index, "assetId"],
        });
      }
    });
  })
  .transform((section) => {
    const mediaByAssetId = new Map(section.media.map((item) => [item.assetId, item]));
    return {
      ...section,
      // Legacy drafts and the stable generation response carry only assetIds.
      // Hydrate their presentation here so every editor receives one shape.
      media: section.assetIds.map((assetId) => mediaByAssetId.get(assetId) ?? createDefaultArticleMedia(assetId)),
    };
  });

export const articleDraftContentSchema = z.object({
  title: z.string().trim().max(300).default(""),
  dek: z.string().trim().max(1_000).default(""),
  intro: longTextSchema.default(""),
  sections: z
    .array(articleDraftSectionSchema)
    .max(100)
    .refine((sections) => new Set(sections.map((section) => section.id)).size === sections.length, {
      message: "Section ids must be unique",
    })
    .default([]),
  socialExcerpt: z.string().trim().max(2_200).default(""),
});

export type ArticleDraftContent = z.infer<typeof articleDraftContentSchema>;
export type ArticleDraftContentInput = z.input<typeof articleDraftContentSchema>;

export const instagramCarouselDraftSettingsSchema = z.object({
  aspectRatio: z.enum(["4:5", "1:1"]).default("4:5"),
  slideCount: z.number().int().min(2).max(20).default(5),
  includeCallToAction: z.boolean().default(true),
});

export type InstagramCarouselDraftSettings = z.infer<typeof instagramCarouselDraftSettingsSchema>;

export const instagramCarouselSlidePresentationSchema = z.object({
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Normalized coordinates keep a crop stable at every preview/export size. */
  focalPoint: z
    .object({
      x: z.number().min(0).max(1).default(0.5),
      y: z.number().min(0).max(1).default(0.5),
    })
    .prefault({}),
});

export type InstagramCarouselSlidePresentation = z.infer<typeof instagramCarouselSlidePresentationSchema>;

export const DEFAULT_INSTAGRAM_CAROUSEL_SLIDE_PRESENTATION: Readonly<InstagramCarouselSlidePresentation> = {
  fit: "cover",
  focalPoint: { x: 0.5, y: 0.5 },
};

export const instagramCarouselDraftContentSchema = z.object({
  caption: z.string().max(10_000).default(""),
  slides: z
    .array(
      z.object({
        id: idSchema,
        /** Text-only cover and CTA slides deliberately have no asset. */
        assetId: idSchema.nullable().default(null),
        headline: z.string().trim().max(300).default(""),
        body: z.string().max(2_200).default(""),
        /** Editorial crop state is hydrated locally; generation stays text-led. */
        presentation: instagramCarouselSlidePresentationSchema.prefault({}),
      }),
    )
    .max(20)
    .refine((slides) => new Set(slides.map((slide) => slide.id)).size === slides.length, {
      message: "Slide ids must be unique",
    })
    .default([]),
  hashtags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
});

export type InstagramCarouselDraftContent = z.infer<typeof instagramCarouselDraftContentSchema>;
export type InstagramCarouselDraftContentInput = z.input<typeof instagramCarouselDraftContentSchema>;

const contentDraftBaseSchema = z.object({
  id: idSchema,
  boardId: idSchema,
  /** Display name in the Workspace's Drafts list; independent of article title. */
  name: z.string().trim().min(1).max(160),
  sourceSnapshot: draftSourceSnapshotSchema,
  brief: contentDraftBriefSchema.prefault({}),

  /** Optimistic save token. Every accepted write increments it. */
  version: z.number().int().positive().default(1),
  /** Increments only for editor writes, so a late AI result can be rejected. */
  manualEditVersion: z.number().int().nonnegative().default(0),
  /** Drives a visible warning before a whole-draft regeneration. */
  hasManualEdits: z.boolean().default(false),
  lastGeneratedAt: timestampSchema.nullable().default(null),

  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const articleContentDraftSchema = contentDraftBaseSchema.extend({
  kind: z.literal("article"),
  // `prefault`, not `default`: Zod 4's object default short-circuits parsing,
  // which would leave this as `{}` instead of applying the nested defaults.
  settings: articleDraftSettingsSchema.prefault({}),
  content: articleDraftContentSchema.prefault({}),
});

export const instagramCarouselContentDraftSchema = contentDraftBaseSchema.extend({
  kind: z.literal("instagram_carousel"),
  settings: instagramCarouselDraftSettingsSchema.prefault({}),
  content: instagramCarouselDraftContentSchema.prefault({}),
});

/** Content may only point at the captured source set. A photo disappearing from
 * the current Workspace is fine — it remains in the snapshot — but a foreign id
 * indicates corrupt storage or a generation bug, and that draft is ignored. */
export const contentDraftSchema = z
  .discriminatedUnion("kind", [articleContentDraftSchema, instagramCarouselContentDraftSchema])
  .superRefine((draft, context) => {
    const sourceIds = new Set(draft.sourceSnapshot.assetIds);
    const usedIds =
      draft.kind === "article"
        ? draft.content.sections.flatMap((section) => section.assetIds)
        : draft.content.slides.flatMap((slide) => (slide.assetId ? [slide.assetId] : []));

    if (draft.kind === "article" && new Set(usedIds).size !== usedIds.length) {
      context.addIssue({
        code: "custom",
        message: "An article image may only have one placement",
        path: ["content", "sections"],
      });
    }

    for (const assetId of usedIds) {
      if (!sourceIds.has(assetId)) {
        context.addIssue({
          code: "custom",
          message: `Content asset ${assetId} is not in the source snapshot`,
          path: ["content"],
        });
      }
    }
  });

export type ArticleContentDraft = z.infer<typeof articleContentDraftSchema>;
export type InstagramCarouselContentDraft = z.infer<typeof instagramCarouselContentDraftSchema>;
export type ContentDraft = z.infer<typeof contentDraftSchema>;
export type ContentDraftKind = ContentDraft["kind"];

const storedDraftsSchema = z.object({
  schemaVersion: z.literal(STORE_SCHEMA_VERSION),
  /** Parse entries independently below: one half-written draft must not hide
   * every valid draft beside it. */
  drafts: z.array(z.unknown()),
});

export function contentDraftStorageKey(boardId: string): string {
  return `${STORE_PREFIX}${boardId}`;
}

/** Runtime boundary for data returned by localStorage or a future generator. */
export function parseContentDraft(value: unknown): ContentDraft | null {
  const parsed = contentDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseStoredDrafts(raw: string): ContentDraft[] {
  try {
    const value: unknown = JSON.parse(raw);
    const store = storedDraftsSchema.safeParse(value);
    if (!store.success) return [];
    return store.data.drafts.flatMap((candidate) => {
      const draft = parseContentDraft(candidate);
      return draft ? [draft] : [];
    });
  } catch {
    return [];
  }
}

function readDrafts(boardId: string): ContentDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(contentDraftStorageKey(boardId));
    return raw ? parseStoredDrafts(raw).filter((draft) => draft.boardId === boardId) : [];
  } catch {
    // Storage can throw in private mode. Draft UI remains usable in-memory and
    // the save result below gives the caller a reason it can surface.
    return [];
  }
}

function writeDrafts(boardId: string, drafts: readonly ContentDraft[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      contentDraftStorageKey(boardId),
      JSON.stringify({ schemaVersion: STORE_SCHEMA_VERSION, drafts }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Newest first for the Drafts menu. Returns [] for missing, foreign, corrupt,
 * or unavailable storage and never throws during a Client Component render. */
export function listContentDrafts(boardId: string): ContentDraft[] {
  return readDrafts(boardId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function loadContentDraft(boardId: string, draftId: string): ContentDraft | null {
  return readDrafts(boardId).find((draft) => draft.id === draftId) ?? null;
}

export type ContentDraftSaveMode = "system" | "manual" | "generated";

export interface SaveContentDraftOptions {
  /** `draft.version` is used when omitted. Supply the version captured when an
   * async generation started to reject its result after any intervening save. */
  expectedVersion?: number;
  /** `draft.manualEditVersion` is used when omitted. This second token makes
   * the manual-edit guard explicit at generation call sites. */
  expectedManualEditVersion?: number;
  mode?: ContentDraftSaveMode;
  /** Injectable for deterministic tests; defaults to the current instant. */
  now?: string;
}

export type SaveContentDraftResult<TDraft extends ContentDraft = ContentDraft> =
  | { ok: true; created: boolean; draft: TDraft }
  | { ok: false; reason: "invalid" | "conflict" | "storage_unavailable"; current: TDraft | null };

/** Create or update one draft. Existing drafts use optimistic version checks;
 * generated output therefore cannot land over text edited while the job ran.
 * A manual write increments both tokens and sets the persistent warning flag. */
export function saveContentDraft(
  boardId: string,
  candidate: ArticleContentDraft,
  options?: SaveContentDraftOptions,
): SaveContentDraftResult<ArticleContentDraft>;
export function saveContentDraft(
  boardId: string,
  candidate: InstagramCarouselContentDraft,
  options?: SaveContentDraftOptions,
): SaveContentDraftResult<InstagramCarouselContentDraft>;
export function saveContentDraft(
  boardId: string,
  candidate: ContentDraft,
  options?: SaveContentDraftOptions,
): SaveContentDraftResult;
export function saveContentDraft(
  boardId: string,
  candidate: ContentDraft,
  options: SaveContentDraftOptions = {},
): SaveContentDraftResult {
  if (candidate.boardId !== boardId) return { ok: false, reason: "invalid", current: null };

  const drafts = readDrafts(boardId);
  const existingIndex = drafts.findIndex((draft) => draft.id === candidate.id);
  const current = existingIndex >= 0 ? drafts[existingIndex] : null;
  const mode = options.mode ?? "system";
  const now = options.now ?? new Date().toISOString();

  // IDs identify one immutable output kind. Treat a collision with a foreign
  // kind as corrupt storage rather than returning a carousel through the
  // article overload (or silently replacing it).
  if (current && current.kind !== candidate.kind) return { ok: false, reason: "invalid", current: null };

  if (current) {
    const expectedVersion = options.expectedVersion ?? candidate.version;
    const expectedManualEditVersion = options.expectedManualEditVersion ?? candidate.manualEditVersion;
    if (current.version !== expectedVersion || current.manualEditVersion !== expectedManualEditVersion) {
      return { ok: false, reason: "conflict", current };
    }
  }

  const nextValue: unknown = {
    ...candidate,
    version: current ? current.version + 1 : 1,
    manualEditVersion:
      mode === "manual" ? (current?.manualEditVersion ?? candidate.manualEditVersion) + 1 : (current?.manualEditVersion ?? 0),
    hasManualEdits: mode === "manual" ? true : (current?.hasManualEdits ?? candidate.hasManualEdits),
    lastGeneratedAt: mode === "generated" ? now : (current?.lastGeneratedAt ?? candidate.lastGeneratedAt),
    createdAt: current?.createdAt ?? candidate.createdAt,
    updatedAt: now,
  };
  const next = parseContentDraft(nextValue);
  if (!next) return { ok: false, reason: "invalid", current };

  if (existingIndex >= 0) drafts[existingIndex] = next;
  else drafts.push(next);

  if (!writeDrafts(boardId, drafts)) return { ok: false, reason: "storage_unavailable", current };
  return { ok: true, created: current === null, draft: next };
}

/** Delete is scoped by board id and returns whether a persisted draft existed.
 * The last deletion removes the key instead of leaving an empty envelope. */
export function deleteContentDraft(boardId: string, draftId: string): boolean {
  if (typeof window === "undefined") return false;
  const drafts = readDrafts(boardId);
  const next = drafts.filter((draft) => draft.id !== draftId);
  if (next.length === drafts.length) return false;
  try {
    if (next.length === 0) window.localStorage.removeItem(contentDraftStorageKey(boardId));
    else if (!writeDrafts(boardId, next)) return false;
    return true;
  } catch {
    return false;
  }
}

export interface CreateDraftBase {
  id?: string;
  boardId: string;
  name?: string;
  sourceAssetIds: readonly string[];
  brief?: Partial<ContentDraftBrief>;
  now?: string;
}

function newDraftId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createDraftBase(input: CreateDraftBase, fallbackName: string): z.input<typeof contentDraftBaseSchema> {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? newDraftId(),
    boardId: input.boardId,
    name: input.name ?? fallbackName,
    sourceSnapshot: { assetIds: [...input.sourceAssetIds], capturedAt: now },
    brief: input.brief,
    version: 1,
    manualEditVersion: 0,
    hasManualEdits: false,
    lastGeneratedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createArticleDraft(
  input: CreateDraftBase & { settings?: Partial<ArticleDraftSettings>; content?: ArticleDraftContentInput },
): ArticleContentDraft {
  const draft = contentDraftSchema.parse({
    ...createDraftBase(input, "Untitled article"),
    kind: "article",
    settings: input.settings,
    content: input.content,
  });
  if (draft.kind !== "article") throw new Error("Article draft parsed as a different kind");
  return draft;
}

export function createInstagramCarouselDraft(
  input: CreateDraftBase & {
    settings?: Partial<InstagramCarouselDraftSettings>;
    content?: InstagramCarouselDraftContentInput;
  },
): InstagramCarouselContentDraft {
  const draft = contentDraftSchema.parse({
    ...createDraftBase(input, "Untitled carousel"),
    kind: "instagram_carousel",
    settings: input.settings,
    content: input.content,
  });
  if (draft.kind !== "instagram_carousel") throw new Error("Carousel draft parsed as a different kind");
  return draft;
}

/** Workspace membership is a set: reordering chips or API rows does not change
 * the sources, while any addition or removal does. */
export function sourcesChanged(snapshot: DraftSourceSnapshot, currentAssetIds: readonly string[]): boolean {
  const current = new Set(currentAssetIds);
  if (current.size !== snapshot.assetIds.length) return true;
  return snapshot.assetIds.some((assetId) => !current.has(assetId));
}
