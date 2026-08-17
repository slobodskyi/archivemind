import { describe, expect, it } from "vitest";
import {
  CAPTION_LANG_NAMES,
  CAPTION_PROMPTS,
  COMPLETE_UPLOAD_MAX_ITEMS,
  SINGLE_PUT_MAX_BYTES,
  addProjectAssetsRequestSchema,
  EXPORT_ARTIFACTS,
  artboardSettingsSchema,
  assetKindFromMime,
  boardSchema,
  patchBoardRequestSchema,
  exportFilename,
  exportFormatSchema,
  canvasGroupKindSchema,
  createTopicRequestSchema,
  createTopicResponseSchema,
  createCanvasGroupRequestSchema,
  createExportRequestSchema,
  exportJobPayloadSchema,
  groupAssetsRequestSchema,
  patchCanvasGroupRequestSchema,
  patchWorkspaceRequestSchema,
  resolveCaptionText,
  captionJobPayloadSchema,
  captionLangSchema,
  captionStyleSchema,
  clusterJobPayloadSchema,
  completeUploadRequestSchema,
  completeUploadRpcResponseSchema,
  createJobRequestSchema,
  createProjectRequestSchema,
  driveFileIdSchema,
  dropboxDirectLinkSchema,
  dropboxImportItemSchema,
  isDropboxDirectLink,
  ingestJobPayloadSchema,
  analyzeJobPayloadSchema,
  oneDriveIdSchema,
  oneDriveImportItemSchema,
  oneDriveExpandSchema,
  ONEDRIVE_MAX_FOLDERS_PER_IMPORT,
  googleConnectRequestSchema,
  googleConnectionStatusSchema,
  importItemSchema,
  mimeFromFilename,
  importRequestSchema,
  importResponseSchema,
  patchCaptionRequestSchema,
  patchFactRequestSchema,
  factStatusSchema,
  jobStatusSchema,
  jobTypeSchema,
  memberRoleSchema,
  presignUploadRequestSchema,
  searchParseSchema,
  searchResponseSchema,
  searchResultSchema,
  assignTopicAssetsRequestSchema,
  topicMutationResponseSchema,
  topicsResponseSchema,
  workspaceInfoSchema,
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
    for (const t of ["ingest", "analyze", "caption", "export", "cluster"]) {
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

  it("clusterJobPayloadSchema takes a workspace_id (snake_case, not asset-scoped)", () => {
    const ws = "8f7a1c2e-0000-4000-8000-1234567890ab";
    expect(clusterJobPayloadSchema.parse({ workspace_id: ws }).workspace_id).toBe(ws);
    expect(clusterJobPayloadSchema.safeParse({ workspaceId: ws }).success).toBe(false); // camelCase is the wire body, not the payload
    expect(clusterJobPayloadSchema.safeParse({ workspace_id: "nope" }).success).toBe(false);
    expect(clusterJobPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("createJobRequestSchema never accepts cluster — it is worker-only (ADR 0028)", () => {
    const id = "4df136fe-a1a4-49c1-ab22-1f1713a1c53c";
    expect(createJobRequestSchema.safeParse({ type: "cluster", assetIds: [id] }).success).toBe(false);
    expect(createJobRequestSchema.safeParse({ type: "cluster", workspace_id: id }).success).toBe(false);
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

describe("editable Topic contracts (ADR 0042)", () => {
  const a = "00000000-0000-0000-0000-0000000000a1";
  const b = "00000000-0000-0000-0000-0000000000b2";
  const cluster = "00000000-0000-0000-0000-00000000c001";

  it("creates a named topic from a bounded, deduped selection", () => {
    expect(createTopicRequestSchema.parse({ label: "  Family  ", assetIds: [a, a, b] })).toEqual({
      label: "Family",
      assetIds: [a, b],
    });
    expect(createTopicRequestSchema.safeParse({ label: " ", assetIds: [a] }).success).toBe(false);
    expect(createTopicRequestSchema.safeParse({ label: "x", assetIds: [] }).success).toBe(false);
    expect(createTopicRequestSchema.safeParse({ label: "x", assetIds: Array(501).fill(a) }).success).toBe(false);
    // Workspace tenancy is server-resolved and therefore not part of the body.
    expect(createTopicRequestSchema.parse({ label: "Family", assetIds: [a], workspaceId: b })).toEqual({
      label: "Family",
      assetIds: [a],
    });
  });

  it("assigns to a topic or explicitly resets to the AI baseline", () => {
    expect(assignTopicAssetsRequestSchema.parse({ assetIds: [a, a], clusterId: cluster })).toEqual({
      assetIds: [a],
      clusterId: cluster,
    });
    expect(assignTopicAssetsRequestSchema.parse({ assetIds: [a], clusterId: null })).toEqual({
      assetIds: [a],
      clusterId: null,
    });
    expect(assignTopicAssetsRequestSchema.safeParse({ assetIds: [a] }).success).toBe(false);
    expect(assignTopicAssetsRequestSchema.safeParse({ assetIds: [], clusterId: null }).success).toBe(false);
  });

  it("pins the create/list/success response envelopes consumed by the canvas", () => {
    expect(createTopicResponseSchema.parse({ topic: { id: cluster, label: "Family" } })).toEqual({
      topic: { id: cluster, label: "Family" },
    });
    expect(
      topicsResponseSchema.parse({
        topics: [
          { id: cluster, label: "Family", origin: "manual" },
          { id: a, label: "Street", origin: "generated" },
        ],
      }),
    ).toBeTruthy();
    expect(topicsResponseSchema.safeParse({ topics: [{ id: cluster, label: "x", origin: "human" }] }).success).toBe(
      false,
    );
    expect(topicMutationResponseSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(topicMutationResponseSchema.safeParse({ ok: false }).success).toBe(false);
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

  it("requires a completion UUID and caps each atomic complete batch at 100", () => {
    const one = { r2Key: "ws/originals/x/a.jpg", filename: "a.jpg", mime: "image/jpeg", size: 10 };
    const completionId = "8df136fe-a1a4-49c1-ab22-1f1713a1c53c";
    expect(completeUploadRequestSchema.parse({ completionId, uploads: [one] })).toBeTruthy();
    expect(completeUploadRequestSchema.parse({
      completionId,
      projectId: "4df136fe-a1a4-49c1-ab22-1f1713a1c53c",
      uploads: [one],
    })).toBeTruthy();
    expect(completeUploadRequestSchema.safeParse({ uploads: [one] }).success).toBe(false);
    expect(completeUploadRequestSchema.safeParse({ completionId: "not-a-uuid", uploads: [one] }).success).toBe(false);
    expect(completeUploadRequestSchema.safeParse({ completionId, projectId: "not-a-uuid", uploads: [one] }).success).toBe(false);
    expect(completeUploadRequestSchema.safeParse({ completionId, uploads: [] }).success).toBe(false);
    expect(completeUploadRequestSchema.safeParse({
      completionId,
      uploads: Array(COMPLETE_UPLOAD_MAX_ITEMS + 1).fill(one),
    }).success).toBe(false);
    expect(completeUploadRequestSchema.safeParse({
      completionId,
      uploads: [{ ...one, size: 0 }],
    }).success).toBe(false);
    expect(completeUploadRequestSchema.safeParse({
      completionId,
      uploads: [{ ...one, size: SINGLE_PUT_MAX_BYTES + 1 }],
    }).success).toBe(false);
  });

  it("validates the snake_case result returned by the completion RPC", () => {
    expect(completeUploadRpcResponseSchema.parse({
      asset_ids: ["4df136fe-a1a4-49c1-ab22-1f1713a1c53c"],
      job_id: "8df136fe-a1a4-49c1-ab22-1f1713a1c53c",
    })).toBeTruthy();
    expect(completeUploadRpcResponseSchema.safeParse({
      assetIds: ["4df136fe-a1a4-49c1-ab22-1f1713a1c53c"],
      jobId: "8df136fe-a1a4-49c1-ab22-1f1713a1c53c",
    }).success).toBe(false);
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

  // A confirmed fact is quoted to the model when it writes a caption (the
  // caption handler selects status = 'confirmed'), so this shape gates an AI
  // input, not just a UI flag. The status set must stay the DB enum exactly.
  it("patchFactRequestSchema takes exactly the DB fact_status values", () => {
    for (const status of ["confirmed", "likely", "needs_check"]) {
      expect(patchFactRequestSchema.parse({ status })).toEqual({ status });
      expect(factStatusSchema.parse(status)).toBe(status);
    }
    expect(patchFactRequestSchema.safeParse({ status: "pending" }).success).toBe(false);
    expect(patchFactRequestSchema.safeParse({ status: "unknown" }).success).toBe(false);
    expect(patchFactRequestSchema.safeParse({}).success).toBe(false);
    expect(patchFactRequestSchema.safeParse(null).success).toBe(false);
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
      camera_terms: "sony",
      iso_min: "high",
      aperture: 1.8,
      kinds: ["photo", "video"],
    });
    expect(p.semantic_text).toBe("");
    expect(p.date_from).toBeNull();
    expect(p.place_terms).toEqual([]);
    expect(p.tag_terms).toEqual([]);
    expect(p.camera_terms).toEqual([]); // EXIF fields degrade too, never throw
    expect(p.iso_min).toBeNull();
    expect(p.aperture).toBeNull();
    expect(p.kinds).toEqual([]); // one bad member degrades the whole list, not the request
  });

  it("keeps valid EXIF filters through the parse", () => {
    const p = searchParseSchema.parse({
      semantic_text: "night street",
      camera_terms: ["iphone 13 pro"],
      iso_min: 1600,
      iso_max: null,
      aperture: "f/1.5",
    });
    expect(p.camera_terms).toEqual(["iphone 13 pro"]);
    expect(p.iso_min).toBe(1600);
    expect(p.aperture).toBe("f/1.5");
  });

  it("round-trips a full parse through searchResponseSchema", () => {
    const parsed = {
      semantic_text: "flooded street rescue",
      date_from: "2026-06-01",
      date_to: null,
      place_terms: ["kyiv"],
      tag_terms: ["rescue"],
      camera_terms: [],
      iso_min: null,
      iso_max: null,
      aperture: null,
      kinds: [],
    };
    const resp = searchResponseSchema.parse({
      parsed,
      results: [
        { assetId: id, similarity: 0.87, tier: "strong", matchedTags: ["rescue"], matchedPlace: "Kyiv, Ukraine", matchedText: true, takenAt: null },
      ],
    });
    expect(resp.results[0].matchedTags).toEqual(["rescue"]);
    expect(resp.results[0].tier).toBe("strong");
    expect(resp.results[0].matchedText).toBe(true);
    expect(resp.parsed.semantic_text).toBe("flooded street rescue");
  });

  it("rejects malformed result rows", () => {
    const ok = { assetId: id, similarity: 1, tier: "strong", matchedTags: [], matchedPlace: null, matchedText: false, takenAt: null };
    expect(searchResultSchema.safeParse(ok).success).toBe(true);
    expect(searchResultSchema.safeParse({ ...ok, assetId: "nope" }).success).toBe(false);
    // tier and matchedText are part of the contract now — a row missing either
    // (or with a made-up tier) must fail loudly, not default.
    const { tier: _t, ...noTier } = ok;
    expect(searchResultSchema.safeParse(noTier).success).toBe(false);
    const { matchedText: _m, ...noText } = ok;
    expect(searchResultSchema.safeParse(noText).success).toBe(false);
    expect(searchResultSchema.safeParse({ ...ok, tier: "best" }).success).toBe(false);
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

describe("dropbox import contracts (ADR 0008, #24)", () => {
  it("accepts real Chooser direct links (dl.dropboxusercontent.com + subdomains)", () => {
    for (const ok of [
      "https://dl.dropboxusercontent.com/1/view/abc123/photo.jpg",
      "https://uc1234abcd.dl.dropboxusercontent.com/cd/0/get/XYZ/file",
    ]) {
      expect(isDropboxDirectLink(ok)).toBe(true);
      expect(dropboxDirectLinkSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("rejects every SSRF shape — the link feeds a server-side fetch", () => {
    for (const evil of [
      "http://dl.dropboxusercontent.com/x", // no TLS
      "https://dl.dropboxusercontent.com.evil.com/x", // suffix spoof
      "https://evil.com/dl.dropboxusercontent.com", // host in path
      "https://user:pass@dl.dropboxusercontent.com/x", // credentials
      "https://dl.dropboxusercontent.com:8443/x", // port games
      "https://169.254.169.254/latest/meta-data", // cloud metadata
      "https://localhost/x",
      "https://www.dropbox.com/s/abc/photo.jpg?dl=1", // share link, not direct
      "ftp://dl.dropboxusercontent.com/x",
      "not-a-url",
      "",
    ]) {
      expect(isDropboxDirectLink(evil)).toBe(false);
      expect(dropboxDirectLinkSchema.safeParse(evil).success).toBe(false);
    }
  });

  it("parses a Chooser file shape (sourceId is a dedupe key, not a URL part)", () => {
    const item = {
      sourceId: "id:a4ayc_80_OEAAAAAAAAAXw",
      name: "DSC01.jpg",
      link: "https://dl.dropboxusercontent.com/1/view/abc/DSC01.jpg",
      sizeBytes: 123,
    };
    expect(dropboxImportItemSchema.parse(item).sourceId).toBe(item.sourceId);
    expect(dropboxImportItemSchema.safeParse({ ...item, link: "https://evil.com/x" }).success).toBe(false);
  });

  it("ingest payload carries optional dropbox links keyed by asset", () => {
    const base = { asset_ids: ["8f7a1c2e-0000-4000-8000-1234567890ab"] };
    expect(ingestJobPayloadSchema.parse(base).dropbox).toBeUndefined();
    const withLinks = ingestJobPayloadSchema.parse({
      ...base,
      dropbox: [
        {
          asset_id: base.asset_ids[0],
          link: "https://dl.dropboxusercontent.com/1/view/abc/x.jpg",
          name: "x.jpg",
        },
      ],
    });
    expect(withLinks.dropbox).toHaveLength(1);
    expect(
      ingestJobPayloadSchema.safeParse({
        ...base,
        dropbox: [{ asset_id: base.asset_ids[0], link: "https://evil.com/x", name: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("importRequestSchema provider union + mimeFromFilename (#24)", () => {
  it("keeps the gdrive shape and adds the connection-less dropbox shape", () => {
    expect(
      importRequestSchema.safeParse({
        provider: "dropbox",
        items: [{ sourceId: "id:abc", name: "a.jpg", link: "https://dl.dropboxusercontent.com/1/x/a.jpg" }],
      }).success,
    ).toBe(true);
    // dropbox never takes a connectionId; gdrive still requires one
    expect(
      importRequestSchema.safeParse({
        provider: "gdrive",
        items: [{ fileId: "1SX3tiZm22Tb-0ZWHYBY7GdU847VoZC3V", name: "a.jpg", mimeType: "image/jpeg" }],
      }).success,
    ).toBe(false);
  });

  it("infers mime from extension; RAW/unknown fall to octet-stream", () => {
    expect(mimeFromFilename("DSC01.JPG")).toBe("image/jpeg");
    expect(mimeFromFilename("scan.tiff")).toBe("image/tiff");
    expect(mimeFromFilename("IMG_1.HEIC")).toBe("image/heic");
    expect(mimeFromFilename("shot.NEF")).toBe("application/octet-stream");
    expect(mimeFromFilename("noext")).toBe("application/octet-stream");
  });
});

describe("OneDrive import contracts (ADR 0047)", () => {
  const uuid = "8f7a1c2e-0000-4000-8000-1234567890ab";

  it("ids accept real Graph shapes but never URL structure", () => {
    // personal (bang-separated) and business (b!-prefixed) ids both parse
    expect(oneDriveIdSchema.parse("01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K")).toBeTruthy();
    expect(oneDriveIdSchema.parse("A1B2C3D4E5!107")).toBeTruthy();
    expect(oneDriveIdSchema.parse("b!Ci_5vT-xyz_ABC-123")).toBeTruthy();
    // the id is interpolated into a Graph path — nothing structural gets through
    for (const bad of ["../../me/drive", "a/b", "a?$select=x", "a#frag", "a%2f", "a b", ""]) {
      expect(oneDriveIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("an import item defaults to a file and always carries both id halves", () => {
    const item = oneDriveImportItemSchema.parse({
      driveId: "drive1",
      itemId: "item1",
      name: "  DSC01.jpg  ",
    });
    // isFolder defaults false — an unmarked item is a file, never a surprise walk
    expect(item.isFolder).toBe(false);
    expect(item.name).toBe("DSC01.jpg");
    // a driveItem id alone is not an identity: the drive scope is required
    expect(
      oneDriveImportItemSchema.safeParse({ itemId: "item1", name: "a.jpg" }).success,
    ).toBe(false);
  });

  it("the onedrive arm needs the caller's connection, like gdrive", () => {
    const items = [{ driveId: "drive1", itemId: "item1", name: "a.jpg", isFolder: true }];
    expect(
      importRequestSchema.safeParse({ provider: "onedrive", connectionId: uuid, items }).success,
    ).toBe(true);
    expect(importRequestSchema.safeParse({ provider: "onedrive", items }).success).toBe(false);
  });

  it("expansion caps the folders one import may walk", () => {
    const folder = { drive_id: "drive1", item_id: "item1", name: "2024" };
    expect(
      oneDriveExpandSchema.safeParse({ connection_id: uuid, folders: [folder] }).success,
    ).toBe(true);
    expect(
      oneDriveExpandSchema.safeParse({
        connection_id: uuid,
        folders: Array.from({ length: ONEDRIVE_MAX_FOLDERS_PER_IMPORT + 1 }, () => folder),
      }).success,
    ).toBe(false);
  });

  it("an ingest job may start with no assets ONLY when it has folders to expand", () => {
    const expand = {
      connection_id: uuid,
      folders: [{ drive_id: "drive1", item_id: "item1", name: "2024" }],
    };
    // a folders-only import: every asset is discovered by the walk
    expect(ingestJobPayloadSchema.parse({ asset_ids: [], onedrive_expand: expand })).toBeTruthy();
    // without folders, an empty ingest is still the bug it always was
    expect(ingestJobPayloadSchema.safeParse({ asset_ids: [] }).success).toBe(false);
    // fanned-out batches carry assets and NO expand key — the loop guard
    expect(ingestJobPayloadSchema.parse({ asset_ids: [uuid] }).onedrive_expand).toBeUndefined();
  });

  it("analyze did not inherit ingest's empty-asset allowance", () => {
    // analyzeJobPayloadSchema was `= ingestJobPayloadSchema` until ADR 0047;
    // relaxing ingest must never make "analyze nothing" parse.
    expect(analyzeJobPayloadSchema.safeParse({ asset_ids: [] }).success).toBe(false);
    expect(analyzeJobPayloadSchema.parse({ asset_ids: [uuid] }).asset_ids).toHaveLength(1);
  });
});

describe("canvas groups: folders + artboards (ADR 0034)", () => {
  it("kind is exactly folder | artboard", () => {
    expect(canvasGroupKindSchema.parse("folder")).toBe("folder");
    expect(canvasGroupKindSchema.parse("artboard")).toBe("artboard");
    expect(canvasGroupKindSchema.safeParse("frame").success).toBe(false);
  });

  it("createCanvasGroupRequest defaults assetIds to [] and takes an optional scope", () => {
    const r = createCanvasGroupRequestSchema.parse({ kind: "folder", name: "Yoga" });
    expect(r.assetIds).toEqual([]);
    expect(r.projectId).toBeUndefined();
    // trims + caps the name; rejects empty
    expect(createCanvasGroupRequestSchema.safeParse({ kind: "folder", name: "  " }).success).toBe(false);
    expect(
      createCanvasGroupRequestSchema.safeParse({ kind: "artboard", name: "x".repeat(81) }).success,
    ).toBe(false);
  });

  it("artboardSettings fills every default from {}", () => {
    const s = artboardSettingsSchema.parse({});
    expect(s.format).toBe("pdf");
    expect(s.pageLayout).toBe("one_per_page");
    expect(s.pageSize).toBe("A4");
    expect(s.orientation).toBe("portrait");
    expect(s.captionLang).toBe("en");
    expect(s.captionStyle).toBe("agency");
    expect(s.include).toEqual({ caption: true, title: true, exif: false });
  });

  it("strips a stale include.facts flag instead of rejecting the row", () => {
    // Settings persisted before facts left the PDF must still parse.
    const s = artboardSettingsSchema.parse({ include: { caption: true, title: true, facts: true, exif: false } });
    expect(s.include).toEqual({ caption: true, title: true, exif: false });
  });

  it("patchCanvasGroupRequest needs at least one field", () => {
    expect(patchCanvasGroupRequestSchema.safeParse({}).success).toBe(false);
    expect(patchCanvasGroupRequestSchema.safeParse({ name: "Renamed" }).success).toBe(true);
    expect(patchCanvasGroupRequestSchema.safeParse({ sortIndex: 3 }).success).toBe(true);
  });

  it("groupAssetsRequest requires 1..500 ids", () => {
    expect(groupAssetsRequestSchema.safeParse({ assetIds: [] }).success).toBe(false);
    expect(
      groupAssetsRequestSchema.safeParse({
        assetIds: ["00000000-0000-0000-0000-0000000000f1"],
      }).success,
    ).toBe(true);
  });
});

/** Workspaces are trashed, not deleted (ADR 0044 as amended): the chip's × is a
 *  PATCH that stamps `deleted_at`, and DELETE stays the permanent one. These two
 *  must not blur into each other at the contract level. */
describe("board trash contract (ADR 0044)", () => {
  it("a board reads as live unless it carries a deletion timestamp", () => {
    const parsed = boardSchema.parse({
      id: "00000000-0000-0000-0000-0000000000e1",
      projectId: "00000000-0000-0000-0000-00000000dda1",
      name: "Pitch",
      color: "blue",
      sortOrder: 0,
      assetIds: [],
    });
    expect(parsed.deletedAt).toBeNull();
  });

  it("carries the timestamp when there is one", () => {
    const parsed = boardSchema.parse({
      id: "00000000-0000-0000-0000-0000000000e1",
      projectId: "00000000-0000-0000-0000-00000000dda1",
      name: "Pitch",
      color: "blue",
      sortOrder: 0,
      assetIds: [],
      deletedAt: "2026-08-13T10:00:00.000Z",
    });
    expect(parsed.deletedAt).toBe("2026-08-13T10:00:00.000Z");
  });

  it("patchBoardRequest takes the trash pair in both directions", () => {
    expect(patchBoardRequestSchema.safeParse({ deleted: true }).success).toBe(true);
    expect(patchBoardRequestSchema.safeParse({ deleted: false }).success).toBe(true);
  });

  it("still needs at least one field", () => {
    expect(patchBoardRequestSchema.safeParse({}).success).toBe(false);
    expect(patchBoardRequestSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("does not take a client-supplied deletion time — the server stamps it", () => {
    const parsed = patchBoardRequestSchema.safeParse({ deletedAt: "2026-08-13T10:00:00.000Z" });
    expect(parsed.success).toBe(false);
  });
});

describe("artboard PDF export (ADR 0035)", () => {
  const opts = artboardSettingsSchema.parse({});

  it("createExportRequest accepts a groupId OR a selection, never neither", () => {
    expect(
      createExportRequestSchema.safeParse({
        groupId: "00000000-0000-0000-0000-0000000000c2",
        options: opts,
      }).success,
    ).toBe(true);
    expect(
      createExportRequestSchema.safeParse({
        assetIds: ["00000000-0000-0000-0000-0000000000f1"],
        options: opts,
      }).success,
    ).toBe(true);
    // neither source → rejected
    expect(createExportRequestSchema.safeParse({ options: opts }).success).toBe(false);
  });

  it("exportJobPayload mirrors the request in snake_case and carries result_key", () => {
    const p = exportJobPayloadSchema.parse({
      group_id: "00000000-0000-0000-0000-0000000000c2",
      options: opts,
      // A KEY, never a URL: a presigned URL stored here would be a 7-day bearer
      // token readable by every workspace member (ai_jobs RLS is is_member with
      // no column restriction) and broadcast to all of them on update.
      result_key: "ws/exports/j.pdf",
    });
    expect(p.result_key).toContain(".pdf");
    expect(exportJobPayloadSchema.safeParse({ options: opts }).success).toBe(false);
  });
});

describe("workspace credit block", () => {
  it("accepts a partial patch and rejects an empty one", () => {
    expect(patchWorkspaceRequestSchema.safeParse({ credit: "Photo: O. S." }).success).toBe(true);
    expect(patchWorkspaceRequestSchema.safeParse({ creator: null }).success).toBe(true);
    expect(patchWorkspaceRequestSchema.safeParse({}).success).toBe(false);
  });

  it("trims and bounds each field", () => {
    expect(patchWorkspaceRequestSchema.parse({ credit: "  Photo: O. S.  " }).credit).toBe("Photo: O. S.");
    expect(patchWorkspaceRequestSchema.safeParse({ credit: "x".repeat(301) }).success).toBe(false);
    expect(patchWorkspaceRequestSchema.safeParse({ usageTerms: "x".repeat(501) }).success).toBe(false);
  });

  it("keeps every credit field nullable — no byline is a valid state", () => {
    const info = workspaceInfoSchema.parse({
      id: "00000000-0000-0000-0000-00000000aaaa",
      name: "WS",
      creator: null,
      credit: null,
      copyrightNotice: null,
      usageTerms: null,
      canEdit: false,
    });
    expect(info.credit).toBeNull();
    expect(info.canEdit).toBe(false);
  });
});

describe("export formats", () => {
  it("keeps `format` a FLAT field so a maybe-{} settings blob still parses", () => {
    // Three live call sites do artboardSettingsSchema.parse(<jsonb settings>);
    // a discriminated union on format would reject every one of them.
    expect(artboardSettingsSchema.parse({}).format).toBe("pdf");
    expect(artboardSettingsSchema.parse({ format: "captions_csv" }).format).toBe("captions_csv");
    expect(artboardSettingsSchema.safeParse({ format: "docx" }).success).toBe(false);
  });

  it("gives every format an extension and a MIME type", () => {
    for (const f of exportFormatSchema.options) {
      expect(EXPORT_ARTIFACTS[f].ext).toMatch(/^[a-z0-9]+$/);
      expect(EXPORT_ARTIFACTS[f].contentType).toContain("/");
    }
    // The CSV carries uk/ru captions — the charset is part of the contract.
    expect(EXPORT_ARTIFACTS.captions_csv.contentType).toContain("charset=utf-8");
  });
});

describe("resolveCaptionText fallback chain", () => {
  const rows = [
    { lang: "en", style: "agency", text: "EN agency" },
    { lang: "uk", style: "social", text: "UK social" },
  ] as const;

  it("prefers the exact (lang, style)", () => {
    expect(resolveCaptionText([...rows], "uk", "social")).toBe("UK social");
  });

  it("falls back to English of the same style, then any EN", () => {
    // uk/agency absent → EN agency (same style)
    expect(resolveCaptionText([...rows], "uk", "agency")).toBe("EN agency");
    // ru absent entirely → any EN
    expect(resolveCaptionText([...rows], "ru", "archival")).toBe("EN agency");
  });

  it("falls back to any style in the requested lang before giving up", () => {
    // only uk/social exists; request uk/agency → same-lang, different style
    expect(resolveCaptionText([{ lang: "uk", style: "social", text: "x" }], "uk", "agency")).toBe("x");
  });

  it("returns '' when no lang/style and no English exist", () => {
    expect(resolveCaptionText([{ lang: "uk", style: "social", text: "x" }], "ru", "agency")).toBe("");
    expect(resolveCaptionText([], "en", "agency")).toBe("");
  });
});

describe("exportFilename", () => {
  const date = "2026-07-27T15:04:05.000Z";

  it("slugs the document title and stamps the date", () => {
    expect(exportFilename("Odesa 2026", "pdf", date)).toBe("odesa-2026-2026-07-27.pdf");
  });

  it("keeps Cyrillic (the Content-Disposition carries filename* as UTF-8)", () => {
    expect(exportFilename("Одеса, літо", "zip", date)).toBe("одеса-літо-2026-07-27.zip");
  });

  it("never yields a bare uuid or an empty stem", () => {
    // The old download was named after the job id, which told the recipient nothing.
    expect(exportFilename(null, "csv", date)).toBe("archivemind-2026-07-27.csv");
    expect(exportFilename("!!!", "pdf", date)).toBe("archivemind-2026-07-27.pdf");
    expect(exportFilename("   ", "pdf", date)).toBe("archivemind-2026-07-27.pdf");
  });

  it("collapses separators and bounds the stem", () => {
    expect(exportFilename("a  //  b", "pdf", date)).toBe("a-b-2026-07-27.pdf");
    const long = exportFilename("x".repeat(200), "pdf", date);
    expect(long.startsWith(`${"x".repeat(60)}-`)).toBe(true);
  });
});
