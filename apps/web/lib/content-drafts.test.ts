import { beforeEach, describe, expect, it } from "vitest";
import {
  contentDraftStorageKey,
  createArticleDraft,
  createInstagramCarouselDraft,
  deleteContentDraft,
  listContentDrafts,
  loadContentDraft,
  parseContentDraft,
  adoptContentDraft,
  saveContentDraft,
  sourcesChanged,
  type ArticleContentDraft,
} from "./content-drafts";

const BOARD = "board-a";
const OTHER_BOARD = "board-b";
const CREATED_AT = "2026-08-13T09:00:00.000Z";
const UPDATED_AT = "2026-08-13T10:00:00.000Z";

interface MemoryStorage {
  values: Map<string, string>;
  failWrites: boolean;
}

/** Vitest runs in Node. A deliberately tiny browser boundary exercises the
 * same call-time `window` checks as the production helpers without jsdom. */
function installStorage(): MemoryStorage {
  const memory: MemoryStorage = { values: new Map<string, string>(), failWrites: false };
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => memory.values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (memory.failWrites) throw new Error("quota");
        memory.values.set(key, value);
      },
      removeItem: (key: string) => memory.values.delete(key),
    },
  };
  return memory;
}

let memory: MemoryStorage;

beforeEach(() => {
  memory = installStorage();
});

function article(overrides: Partial<ArticleContentDraft> = {}): ArticleContentDraft {
  return createArticleDraft({
    id: "draft-article",
    boardId: BOARD,
    name: "Kyiv after dark",
    sourceAssetIds: ["asset-1", "asset-2"],
    brief: { prompt: "A night-photo essay", language: "uk" },
    content: {
      title: "Київ після темряви",
      sections: [{ id: "section-1", heading: "Ніч", body: "Текст", assetIds: ["asset-2"] }],
    },
    now: CREATED_AT,
    ...overrides,
  });
}

describe("draft shapes", () => {
  it("creates a structured article with a source snapshot and safe defaults", () => {
    const draft = article();

    expect(draft).toMatchObject({
      kind: "article",
      boardId: BOARD,
      name: "Kyiv after dark",
      sourceSnapshot: { assetIds: ["asset-1", "asset-2"], capturedAt: CREATED_AT },
      brief: { prompt: "A night-photo essay", language: "uk", audience: "", tone: "" },
      settings: { length: "medium", imageCount: 5 },
      content: { title: "Київ після темряви", intro: "", socialExcerpt: "" },
      version: 1,
      manualEditVersion: 0,
      hasManualEdits: false,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    expect(draft.content.sections[0].media).toEqual([
      {
        assetId: "asset-2",
        presentation: {
          width: "wide",
          alignment: "center",
          aspect: "original",
          fit: "cover",
          focalPoint: { x: 0.5, y: 0.5 },
        },
        caption: "",
        altText: "",
      },
    ]);
  });

  it("hydrates missing media in asset order while preserving explicit presentation", () => {
    const draft = createArticleDraft({
      boardId: BOARD,
      sourceAssetIds: ["asset-1", "asset-2"],
      content: {
        sections: [
          {
            id: "section-1",
            assetIds: ["asset-1", "asset-2"],
            media: [
              {
                assetId: "asset-2",
                presentation: { width: "small", focalPoint: { x: 0.2 } },
                caption: "A detail",
              },
            ],
          },
        ],
      },
      now: CREATED_AT,
    });

    expect(draft.content.sections[0].media.map((item) => item.assetId)).toEqual(["asset-1", "asset-2"]);
    expect(draft.content.sections[0].media[0].presentation).toMatchObject({
      width: "wide",
      alignment: "center",
      focalPoint: { x: 0.5, y: 0.5 },
    });
    expect(draft.content.sections[0].media[1]).toMatchObject({
      assetId: "asset-2",
      presentation: {
        width: "small",
        alignment: "center",
        aspect: "original",
        fit: "cover",
        focalPoint: { x: 0.2, y: 0.5 },
      },
      caption: "A detail",
      altText: "",
    });
  });

  it("creates a structured Instagram carousel independently of article fields", () => {
    const draft = createInstagramCarouselDraft({
      id: "draft-carousel",
      boardId: BOARD,
      sourceAssetIds: ["asset-3", "asset-4"],
      settings: { aspectRatio: "1:1", slideCount: 3 },
      content: {
        caption: "Post caption",
        slides: [
          { id: "cover", assetId: null, headline: "Five moments", body: "Swipe" },
          { id: "photo", assetId: "asset-3", headline: "Moment one", body: "Story" },
        ],
        hashtags: ["#archive"],
      },
      now: CREATED_AT,
    });

    expect(draft.kind).toBe("instagram_carousel");
    expect(draft.name).toBe("Untitled carousel");
    expect(draft.settings).toEqual({ aspectRatio: "1:1", slideCount: 3, includeCallToAction: true });
    expect(draft.content.slides[1].assetId).toBe("asset-3");
    expect(draft.content.slides[1].presentation).toEqual({
      fit: "cover",
      focalPoint: { x: 0.5, y: 0.5 },
    });
  });

  it("hydrates partial carousel image presentation and preserves explicit crop state", () => {
    const draft = createInstagramCarouselDraft({
      boardId: BOARD,
      sourceAssetIds: ["asset-3"],
      content: {
        slides: [
          {
            id: "photo",
            assetId: "asset-3",
            headline: "Moment one",
            body: "Story",
            presentation: { fit: "contain", focalPoint: { x: 0.2 } },
          },
        ],
      },
      now: CREATED_AT,
    });

    expect(draft.content.slides[0].presentation).toEqual({
      fit: "contain",
      focalPoint: { x: 0.2, y: 0.5 },
    });
  });

  it("rejects invalid carousel focal coordinates", () => {
    const valid = createInstagramCarouselDraft({
      boardId: BOARD,
      sourceAssetIds: ["asset-3"],
      content: {
        slides: [{ id: "photo", assetId: "asset-3", headline: "", body: "" }],
      },
      now: CREATED_AT,
    });

    expect(
      parseContentDraft({
        ...valid,
        content: {
          ...valid.content,
          slides: [
            {
              ...valid.content.slides[0],
              presentation: { fit: "cover", focalPoint: { x: 0.5, y: 1.01 } },
            },
          ],
        },
      }),
    ).toBeNull();
  });

  it("rejects content that points outside its captured source set", () => {
    const valid = article();
    expect(
      parseContentDraft({
        ...valid,
        content: {
          ...valid.content,
          sections: [{ id: "section-1", heading: "", body: "", assetIds: ["foreign-asset"] }],
        },
      }),
    ).toBeNull();

    expect(() =>
      createInstagramCarouselDraft({
        boardId: BOARD,
        sourceAssetIds: ["asset-1"],
        content: {
          slides: [{ id: "slide-1", assetId: "foreign-asset", headline: "", body: "" }],
        },
        now: CREATED_AT,
      }),
    ).toThrow();
  });

  it("rejects duplicate article placements across sections", () => {
    const valid = article();
    expect(
      parseContentDraft({
        ...valid,
        content: {
          ...valid.content,
          sections: [
            { id: "one", heading: "", body: "", assetIds: ["asset-2"] },
            { id: "two", heading: "", body: "", assetIds: ["asset-2"] },
          ],
        },
      }),
    ).toBeNull();
  });

  it("rejects media that is foreign, duplicated, or has an invalid focal point", () => {
    const valid = article();
    const section = valid.content.sections[0];

    expect(
      parseContentDraft({
        ...valid,
        content: {
          ...valid.content,
          sections: [{ ...section, media: [{ assetId: "asset-1" }, { assetId: "foreign-asset" }] }],
        },
      }),
    ).toBeNull();
    expect(
      parseContentDraft({
        ...valid,
        content: {
          ...valid.content,
          sections: [{ ...section, assetIds: ["asset-2"], media: [{ assetId: "asset-2" }, { assetId: "asset-2" }] }],
        },
      }),
    ).toBeNull();
    expect(
      parseContentDraft({
        ...valid,
        content: {
          ...valid.content,
          sections: [
            {
              ...section,
              media: [{ assetId: "asset-2", presentation: { focalPoint: { x: -0.01, y: 0.5 } } }],
            },
          ],
        },
      }),
    ).toBeNull();
  });
});

describe("browser-local CRUD", () => {
  it("uses one versioned storage key per board", () => {
    expect(contentDraftStorageKey(BOARD)).toBe("archivemind:content-drafts:v1:board-a");

    const first = saveContentDraft(BOARD, article(), { now: CREATED_AT });
    const other = createArticleDraft({
      id: "other-draft",
      boardId: OTHER_BOARD,
      sourceAssetIds: ["asset-9"],
      now: CREATED_AT,
    });
    saveContentDraft(OTHER_BOARD, other, { now: CREATED_AT });

    expect(first.ok).toBe(true);
    expect(listContentDrafts(BOARD).map((draft) => draft.id)).toEqual(["draft-article"]);
    expect(listContentDrafts(OTHER_BOARD).map((draft) => draft.id)).toEqual(["other-draft"]);
  });

  it("saves, loads, lists newest first, and deletes without touching siblings", () => {
    const older = article();
    const newer = createInstagramCarouselDraft({
      id: "draft-carousel",
      boardId: BOARD,
      sourceAssetIds: ["asset-1"],
      now: UPDATED_AT,
    });

    saveContentDraft(BOARD, older, { now: CREATED_AT });
    saveContentDraft(BOARD, newer, { now: UPDATED_AT });

    expect(listContentDrafts(BOARD).map((draft) => draft.id)).toEqual(["draft-carousel", "draft-article"]);
    expect(loadContentDraft(BOARD, "draft-article")?.kind).toBe("article");
    expect(deleteContentDraft(BOARD, "draft-article")).toBe(true);
    expect(loadContentDraft(BOARD, "draft-article")).toBeNull();
    expect(loadContentDraft(BOARD, "draft-carousel")).not.toBeNull();
    expect(deleteContentDraft(BOARD, "missing")).toBe(false);
  });

  it("falls back safely for malformed JSON, an unknown envelope, and malformed entries", () => {
    const key = contentDraftStorageKey(BOARD);
    memory.values.set(key, "{not json");
    expect(listContentDrafts(BOARD)).toEqual([]);

    memory.values.set(key, JSON.stringify({ schemaVersion: 99, drafts: [article()] }));
    expect(listContentDrafts(BOARD)).toEqual([]);

    memory.values.set(key, JSON.stringify({ schemaVersion: 1, drafts: [{ kind: "article" }, article()] }));
    expect(listContentDrafts(BOARD).map((draft) => draft.id)).toEqual(["draft-article"]);
  });

  it("upgrades a legacy article without media metadata while keeping the v1 key", () => {
    const legacy = article();
    const section = legacy.content.sections[0];
    const legacySection = {
      id: section.id,
      heading: section.heading,
      body: section.body,
      assetIds: section.assetIds,
    };
    memory.values.set(
      contentDraftStorageKey(BOARD),
      JSON.stringify({
        schemaVersion: 1,
        drafts: [
          {
            ...legacy,
            content: { ...legacy.content, sections: [legacySection] },
          },
        ],
      }),
    );

    const loaded = loadContentDraft(BOARD, legacy.id);
    expect(loaded?.kind).toBe("article");
    if (!loaded || loaded.kind !== "article") return;
    expect(loaded.content.sections[0].media).toEqual([
      expect.objectContaining({ assetId: "asset-2", caption: "", altText: "" }),
    ]);
    expect(contentDraftStorageKey(BOARD)).toBe("archivemind:content-drafts:v1:board-a");
  });

  it("upgrades a legacy carousel without slide presentation and saves the hydrated shape", () => {
    const legacy = createInstagramCarouselDraft({
      id: "legacy-carousel",
      boardId: BOARD,
      sourceAssetIds: ["asset-3"],
      content: {
        slides: [{ id: "slide-1", assetId: "asset-3", headline: "Moment", body: "Story" }],
      },
      now: CREATED_AT,
    });
    const slide = legacy.content.slides[0];
    const legacySlide = {
      id: slide.id,
      assetId: slide.assetId,
      headline: slide.headline,
      body: slide.body,
    };
    memory.values.set(
      contentDraftStorageKey(BOARD),
      JSON.stringify({
        schemaVersion: 1,
        drafts: [{ ...legacy, content: { ...legacy.content, slides: [legacySlide] } }],
      }),
    );

    const loaded = loadContentDraft(BOARD, legacy.id);
    expect(loaded?.kind).toBe("instagram_carousel");
    if (!loaded || loaded.kind !== "instagram_carousel") return;
    expect(loaded.content.slides[0].presentation).toEqual({ fit: "cover", focalPoint: { x: 0.5, y: 0.5 } });

    const saved = saveContentDraft(BOARD, loaded, { mode: "manual", now: UPDATED_AT });
    expect(saved.ok).toBe(true);
    expect(loadContentDraft(BOARD, legacy.id)?.content).toMatchObject({
      slides: [{ presentation: { fit: "cover", focalPoint: { x: 0.5, y: 0.5 } } }],
    });
  });

  it("ignores a valid draft filed under a different board", () => {
    memory.values.set(
      contentDraftStorageKey(BOARD),
      JSON.stringify({
        schemaVersion: 1,
        drafts: [createArticleDraft({ boardId: OTHER_BOARD, sourceAssetIds: ["asset-1"], now: CREATED_AT })],
      }),
    );
    expect(listContentDrafts(BOARD)).toEqual([]);
  });

  it("reports storage failure so the UI can show that autosave did not stick", () => {
    memory.failWrites = true;
    expect(saveContentDraft(BOARD, article())).toEqual({
      ok: false,
      reason: "storage_unavailable",
      current: null,
    });
  });
});

describe("version and manual-edit protection", () => {
  it("increments both tokens for a manual save and remembers the warning", () => {
    const created = saveContentDraft(BOARD, article(), { now: CREATED_AT });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited: ArticleContentDraft = {
      ...created.draft,
      content: { ...created.draft.content, title: "Мій заголовок" },
    };
    const saved = saveContentDraft(BOARD, edited, { mode: "manual", now: UPDATED_AT });

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.draft).toMatchObject({
      version: 2,
      manualEditVersion: 1,
      hasManualEdits: true,
      updatedAt: UPDATED_AT,
    });
  });

  it("rejects a late generated result after the user edits the same draft", () => {
    const created = saveContentDraft(BOARD, article(), { now: CREATED_AT });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The generator captures these before it starts.
    const generatedCandidate: ArticleContentDraft = {
      ...created.draft,
      content: { ...created.draft.content, title: "AI title" },
    };
    const manualCandidate: ArticleContentDraft = {
      ...created.draft,
      content: { ...created.draft.content, title: "Human title" },
    };
    saveContentDraft(BOARD, manualCandidate, { mode: "manual", now: UPDATED_AT });

    const late = saveContentDraft(BOARD, generatedCandidate, {
      mode: "generated",
      expectedVersion: created.draft.version,
      expectedManualEditVersion: created.draft.manualEditVersion,
      now: "2026-08-13T11:00:00.000Z",
    });

    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.reason).toBe("conflict");
    expect(late.current?.version).toBe(2);
    expect(loadContentDraft(BOARD, created.draft.id)?.content).toMatchObject({ title: "Human title" });
  });

  it("accepts generation based on the current tokens and records when it landed", () => {
    const created = saveContentDraft(BOARD, article(), { now: CREATED_AT });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const generated = saveContentDraft(
      BOARD,
      { ...created.draft, content: { ...created.draft.content, title: "AI title" } },
      { mode: "generated", now: UPDATED_AT },
    );

    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    expect(generated.draft).toMatchObject({
      version: 2,
      manualEditVersion: 0,
      hasManualEdits: false,
      lastGeneratedAt: UPDATED_AT,
    });
  });
});

describe("sourcesChanged", () => {
  const snapshot = { assetIds: ["asset-1", "asset-2"], capturedAt: CREATED_AT };

  it("treats Workspace membership as a set, not a layout order", () => {
    expect(sourcesChanged(snapshot, ["asset-2", "asset-1"])).toBe(false);
  });

  it("detects additions, removals, and duplicate current membership", () => {
    expect(sourcesChanged(snapshot, ["asset-1", "asset-2", "asset-3"])).toBe(true);
    expect(sourcesChanged(snapshot, ["asset-1"])).toBe(true);
    expect(sourcesChanged(snapshot, ["asset-1", "asset-1"])).toBe(true);
  });
});

describe("adopting the durable server copy", () => {
  it("writes the server's draft verbatim instead of renumbering it", () => {
    const local = saveContentDraft(BOARD, article(), { now: CREATED_AT });
    expect(local.ok && local.draft.version).toBe(1);

    // What comes back from the server is already the newest truth. The
    // authoring path would bump it to 3 simply for having been downloaded.
    const fromServer = { ...(local.ok ? local.draft : article()), version: 2, name: "From server" };
    expect(adoptContentDraft(BOARD, fromServer)).toBe(true);

    const stored = loadContentDraft(BOARD, "draft-article");
    expect(stored?.version).toBe(2);
    expect(stored?.name).toBe("From server");
  });

  it("adds a draft this browser has never seen", () => {
    expect(listContentDrafts(BOARD)).toHaveLength(0);
    expect(adoptContentDraft(BOARD, article())).toBe(true);
    expect(listContentDrafts(BOARD).map((draft) => draft.id)).toEqual(["draft-article"]);
  });

  it("refuses a foreign board and a kind collision rather than silently replacing", () => {
    expect(adoptContentDraft(OTHER_BOARD, article())).toBe(false);

    saveContentDraft(BOARD, article(), { now: CREATED_AT });
    const sameIdWrongKind = createInstagramCarouselDraft({
      id: "draft-article",
      boardId: BOARD,
      sourceAssetIds: ["asset-1"],
      now: CREATED_AT,
    });
    expect(adoptContentDraft(BOARD, sameIdWrongKind)).toBe(false);
    expect(loadContentDraft(BOARD, "draft-article")?.kind).toBe("article");
  });
});
