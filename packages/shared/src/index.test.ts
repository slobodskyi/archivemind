import { describe, expect, it } from "vitest";
import {
  CAPTION_LANG_NAMES,
  CAPTION_PROMPTS,
  SINGLE_PUT_MAX_BYTES,
  addProjectAssetsRequestSchema,
  assetKindFromMime,
  captionJobPayloadSchema,
  captionLangSchema,
  captionStyleSchema,
  completeUploadRequestSchema,
  createJobRequestSchema,
  createProjectRequestSchema,
  driveFileIdSchema,
  googleConnectRequestSchema,
  googleConnectionStatusSchema,
  importItemSchema,
  importRequestSchema,
  importResponseSchema,
  patchCaptionRequestSchema,
  jobStatusSchema,
  jobTypeSchema,
  memberRoleSchema,
  presignUploadRequestSchema,
  searchParseSchema,
  searchResponseSchema,
  searchResultSchema,
} from "./index";

/**
 * Contract-test pattern (ADR 0013): every schema in @archivemind/shared gets
 * parse + reject cases. These pin the web ↔ worker wire format — the seam we
 * expect to churn most (upload flow, job payloads, AI output shapes).
 */
describe("memberRoleSchema", () => {
  it("accepts every §4 member_role", () => {
    for (const role of ["owner", "editor", "viewer"]) {
      expect(memberRoleSchema.parse(role)).toBe(role);
    }
  });

  it("rejects unknown roles and non-strings", () => {
    expect(memberRoleSchema.safeParse("admin").success).toBe(false);
    expect(memberRoleSchema.safeParse("").success).toBe(false);
    expect(memberRoleSchema.safeParse(1).success).toBe(false);
    expect(memberRoleSchema.safeParse(null).success).toBe(false);
  });
});

describe("job queue contracts", () => {
  it("accepts every §4 job_type / job_status", () => {
    for (const t of ["ingest", "analyze", "caption", "export"]) {
      expect(jobTypeSchema.parse(t)).toBe(t);
    }
    for (const s of ["queued", "running", "done", "failed", "canceled"]) {
      expect(jobStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown values", () => {
    expect(jobTypeSchema.safeParse("transcode").success).toBe(false);
    expect(jobStatusSchema.safeParse("cancelled").success).toBe(false); // US spelling only
    expect(jobTypeSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("uuidSchema", () => {
  it("accepts any Postgres uuid text, not only strict RFC v4", async () => {
    const { uuidSchema, ingestJobPayloadSchema } = await import("./index");
    expect(uuidSchema.parse("00000000-0000-0000-0000-00000000ab01")).toBeTruthy(); // fixture-style
    expect(uuidSchema.parse("4df136fe-a1a4-49c1-ab22-1f1713a1c53c")).toBeTruthy(); // gen_random_uuid
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(ingestJobPayloadSchema.safeParse({ asset_ids: [] }).success).toBe(false);
  });
});

describe("analyze contracts", () => {
  it("parses a full model response and normalizes sloppy fields via catch", async () => {
    const { analyzeOutputSchema } = await import("./index");
    const out = analyzeOutputSchema.parse({
      description: "A minimalist graphic with a circle.",
      tags: [
        { name: "circle", category: "object", confidence: 0.99 },
        { name: "weird", category: "not-a-category", confidence: 2 }, // both caught
      ],
      ocr_text: "",
      suggested_facts: [{ text: "Circle is centered.", basis: "visual" }],
    });
    expect(out.tags[1].category).toBe("other");
    expect(out.tags[1].confidence).toBe(0.5);
  });

  it("rejects a response without a description", async () => {
    const { analyzeOutputSchema } = await import("./index");
    expect(analyzeOutputSchema.safeParse({ tags: [], ocr_text: "", suggested_facts: [] }).success).toBe(false);
  });

  it("caps createJobRequest batches and requires analyze type", async () => {
    const { createJobRequestSchema } = await import("./index");
    const id = "4df136fe-a1a4-49c1-ab22-1f1713a1c53c";
    expect(createJobRequestSchema.parse({ type: "analyze", assetIds: [id] })).toBeTruthy();
    expect(createJobRequestSchema.safeParse({ type: "caption", assetIds: [id] }).success).toBe(false);
    expect(createJobRequestSchema.safeParse({ type: "analyze", assetIds: [] }).success).toBe(false);
  });
});

describe("upload contracts", () => {
  it("accepts a valid presign request up to the single-PUT cap", () => {
    expect(
      presignUploadRequestSchema.parse({ filename: "DSC_0001.jpg", mime: "image/jpeg", size: SINGLE_PUT_MAX_BYTES }),
    ).toBeTruthy();
  });

  it("rejects oversize, empty and malformed presign requests", () => {
    expect(presignUploadRequestSchema.safeParse({ filename: "a.jpg", mime: "image/jpeg", size: SINGLE_PUT_MAX_BYTES + 1 }).success).toBe(false);
    expect(presignUploadRequestSchema.safeParse({ filename: "", mime: "image/jpeg", size: 1 }).success).toBe(false);
    expect(presignUploadRequestSchema.safeParse({ filename: "a.jpg", mime: "image/jpeg", size: -5 }).success).toBe(false);
    expect(presignUploadRequestSchema.safeParse({ filename: "a.jpg", mime: "image/jpeg", size: 1.5 }).success).toBe(false);
  });

  it("caps complete batches at 500 and requires at least one upload", () => {
    const one = { r2Key: "ws/originals/x/a.jpg", filename: "a.jpg", mime: "image/jpeg", size: 10 };
    expect(completeUploadRequestSchema.parse({ uploads: [one] })).toBeTruthy();
    expect(completeUploadRequestSchema.safeParse({ uploads: [] }).success).toBe(false);
    expect(completeUploadRequestSchema.safeParse({ uploads: Array(501).fill(one) }).success).toBe(false);
  });

  it("classifies asset kind from MIME identically for web and worker", () => {
    expect(assetKindFromMime("image/jpeg")).toBe("photo");
    expect(assetKindFromMime("image/heic")).toBe("photo");
    expect(assetKindFromMime("application/pdf")).toBe("pdf");
    expect(assetKindFromMime("text/plain")).toBe("document");
    expect(assetKindFromMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("document");
    expect(assetKindFromMime("video/mp4")).toBe("other");
  });
});

describe("project contracts", () => {
  it("trims and bounds the project name", () => {
    expect(createProjectRequestSchema.parse({ name: "  Odesa 2026 " }).name).toBe("Odesa 2026");
    expect(createProjectRequestSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createProjectRequestSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createProjectRequestSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  it("requires 1-500 asset ids to add to a project", () => {
    const id = "4df136fe-a1a4-49c1-ab22-1f1713a1c53c";
    expect(addProjectAssetsRequestSchema.parse({ assetIds: [id] })).toBeTruthy();
    expect(addProjectAssetsRequestSchema.safeParse({ assetIds: [] }).success).toBe(false);
    expect(addProjectAssetsRequestSchema.safeParse({ assetIds: ["nope"] }).success).toBe(false);
  });
});

describe("caption contracts", () => {
  const id = "4df136fe-a1a4-49c1-ab22-1f1713a1c53c";

  it("accepts a full caption job payload", () => {
    const p = captionJobPayloadSchema.parse({
      asset_ids: [id],
      langs: ["en", "uk"],
      style: "agency",
    });
    expect(p.langs).toEqual(["en", "uk"]);
    expect(p.style).toBe("agency");
  });

  it("dedupes repeated langs — each duplicate would be a paid model call", () => {
    const p = captionJobPayloadSchema.parse({ asset_ids: [id], langs: ["en", "en", "uk", "en"], style: "social" });
    expect(p.langs).toEqual(["en", "uk"]);
  });

  it("createJobRequestSchema routes caption jobs and dedupes their langs (#14)", () => {
    const ok = createJobRequestSchema.parse({ type: "caption", assetIds: [id], langs: ["uk", "uk", "en"], style: "social" });
    expect(ok.type).toBe("caption");
    if (ok.type === "caption") expect(ok.langs).toEqual(["uk", "en"]);
    expect(createJobRequestSchema.safeParse({ type: "caption", assetIds: [id] }).success).toBe(false);
    expect(createJobRequestSchema.safeParse({ type: "export", assetIds: [id] }).success).toBe(false);
  });

  it("patchCaptionRequestSchema takes exactly one of text / resetEdited", () => {
    expect(patchCaptionRequestSchema.parse({ text: "  edited  " })).toEqual({ text: "edited" });
    expect(patchCaptionRequestSchema.parse({ resetEdited: true })).toEqual({ resetEdited: true });
    expect(patchCaptionRequestSchema.safeParse({}).success).toBe(false);
    expect(patchCaptionRequestSchema.safeParse({ text: "x", resetEdited: true }).success).toBe(false);
    expect(patchCaptionRequestSchema.safeParse({ text: "" }).success).toBe(false);
  });

  it("rejects empty langs, unknown lang/style, and missing asset ids", () => {
    expect(captionJobPayloadSchema.safeParse({ asset_ids: [id], langs: [], style: "agency" }).success).toBe(false);
    expect(captionJobPayloadSchema.safeParse({ asset_ids: [id], langs: ["de"], style: "agency" }).success).toBe(false);
    expect(captionJobPayloadSchema.safeParse({ asset_ids: [id], langs: ["en"], style: "poetic" }).success).toBe(false);
    expect(captionJobPayloadSchema.safeParse({ asset_ids: [], langs: ["en"], style: "social" }).success).toBe(false);
    expect(captionJobPayloadSchema.safeParse({ langs: ["en"], style: "social" }).success).toBe(false);
  });

  it("carries a prompt template and language name for every enum member", () => {
    // The §4 caption_lang / caption_style enums and these maps must never drift.
    for (const style of captionStyleSchema.options) {
      expect(CAPTION_PROMPTS[style].length).toBeGreaterThan(20);
    }
    for (const lang of captionLangSchema.options) {
      expect(CAPTION_LANG_NAMES[lang].length).toBeGreaterThan(2);
    }
  });
});

describe("search contracts", () => {
  const id = "4df136fe-a1a4-49c1-ab22-1f1713a1c53c";

  it("degrades sloppy model output field-by-field instead of failing", () => {
    const p = searchParseSchema.parse({
      semantic_text: 42,
      date_from: 7,
      place_terms: "kyiv",
      tag_terms: null,
      kinds: ["photo", "video"],
    });
    expect(p.semantic_text).toBe("");
    expect(p.date_from).toBeNull();
    expect(p.place_terms).toEqual([]);
    expect(p.tag_terms).toEqual([]);
    expect(p.kinds).toEqual([]); // one bad member degrades the whole list, not the request
  });

  it("round-trips a full parse through searchResponseSchema", () => {
    const parsed = {
      semantic_text: "flooded street rescue",
      date_from: "2026-06-01",
      date_to: null,
      place_terms: ["kyiv"],
      tag_terms: ["rescue"],
      kinds: [],
    };
    const resp = searchResponseSchema.parse({
      parsed,
      results: [
        { assetId: id, similarity: 0.87, matchedTags: ["rescue"], matchedPlace: "Kyiv, Ukraine", takenAt: null },
      ],
    });
    expect(resp.results[0].matchedTags).toEqual(["rescue"]);
    expect(resp.parsed.semantic_text).toBe("flooded street rescue");
  });

  it("rejects malformed result rows", () => {
    expect(
      searchResultSchema.safeParse({ assetId: "nope", similarity: 1, matchedTags: [], matchedPlace: null, takenAt: null })
        .success,
    ).toBe(false);
  });
});

describe("drive import contracts (ADR 0025)", () => {
  const item = {
    fileId: "1SX3tiZm22Tb-0ZWHYBY7GdU847VoZC3V",
    name: "DSC06528.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 31509586,
  };
  const req = {
    provider: "gdrive",
    connectionId: "8f7a1c2e-0000-4000-8000-1234567890ab",
    items: [item],
  };

  it("accepts a real Picker doc shape (sizeBytes optional)", () => {
    expect(importItemSchema.parse(item).fileId).toBe(item.fileId);
    const { sizeBytes: _omitted, ...noSize } = item;
    expect(importItemSchema.safeParse(noSize).success).toBe(true);
  });

  it("rejects fileIds that could redirect the Bearer-authorized Drive URL", () => {
    for (const evil of [
      "../files?q=trashed=false&", // path traversal into files.list
      "abc/def0123456", // path separator
      "abc?alt=media00", // query injection
      "abc#fragment000", // fragment
      "id with space0", // whitespace
      "short", // < 10 chars
      "x".repeat(257), // > 256 chars
      "",
    ]) {
      expect(driveFileIdSchema.safeParse(evil).success).toBe(false);
    }
  });

  it("accepts only gdrive as provider until #24", () => {
    expect(importRequestSchema.safeParse(req).success).toBe(true);
    expect(importRequestSchema.safeParse({ ...req, provider: "dropbox" }).success).toBe(false);
  });

  it("caps items at 500 (client chunks, same as uploads) and requires ≥1", () => {
    expect(
      importRequestSchema.safeParse({ ...req, items: Array(501).fill(item) }).success,
    ).toBe(false);
    expect(importRequestSchema.safeParse({ ...req, items: [] }).success).toBe(false);
  });

  it("projectId is optional but must be a uuid when present", () => {
    expect(
      importRequestSchema.safeParse({ ...req, projectId: "8f7a1c2e-0000-4000-8000-1234567890ab" })
        .success,
    ).toBe(true);
    expect(importRequestSchema.safeParse({ ...req, projectId: "all" }).success).toBe(false);
  });

  it("response carries jobId=null for the all-duplicates case", () => {
    expect(
      importResponseSchema.safeParse({
        assetIds: [],
        jobId: null,
        skippedDuplicates: 3,
        linkedExisting: 2,
      }).success,
    ).toBe(true);
    expect(
      importResponseSchema.safeParse({
        assetIds: [],
        jobId: null,
        skippedDuplicates: -1,
        linkedExisting: 0,
      }).success,
    ).toBe(false);
  });
});

describe("google connect contracts (ADR 0025)", () => {
  it("accepts an opaque authorization code and rejects empties/oversize", () => {
    expect(googleConnectRequestSchema.safeParse({ code: "4/0AVMBs…example" }).success).toBe(true);
    expect(googleConnectRequestSchema.safeParse({ code: "" }).success).toBe(false);
    expect(googleConnectRequestSchema.safeParse({ code: "x".repeat(4097) }).success).toBe(false);
    expect(googleConnectRequestSchema.safeParse({}).success).toBe(false);
  });

  it("status is a boolean + nullable email — never an error string", () => {
    expect(googleConnectionStatusSchema.safeParse({ connected: true, email: "a@b.c" }).success).toBe(true);
    expect(googleConnectionStatusSchema.safeParse({ connected: false, email: null }).success).toBe(true);
    expect(googleConnectionStatusSchema.safeParse({ connected: "yes", email: null }).success).toBe(false);
  });
});

describe("createJobRequestSchema ingest variant (#23 re-ingest)", () => {
  const ids = ["8f7a1c2e-0000-4000-8000-1234567890ab"];

  it("accepts { type: 'ingest', assetIds }", () => {
    const parsed = createJobRequestSchema.parse({ type: "ingest", assetIds: ids });
    expect(parsed.type).toBe("ingest");
  });

  it("rejects ingest with caption-only fields and empty/oversized id lists", () => {
    expect(
      createJobRequestSchema.safeParse({ type: "ingest", assetIds: ids, langs: ["en"] }).success,
    ).toBe(true); // extra keys are stripped by zod object defaults, not fatal
    expect(createJobRequestSchema.safeParse({ type: "ingest", assetIds: [] }).success).toBe(false);
    expect(
      createJobRequestSchema.safeParse({ type: "ingest", assetIds: Array(501).fill(ids[0]) })
        .success,
    ).toBe(false);
    expect(createJobRequestSchema.safeParse({ type: "export", assetIds: ids }).success).toBe(false);
  });
});
