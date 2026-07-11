import { describe, expect, it } from "vitest";
import {
  SINGLE_PUT_MAX_BYTES,
  addProjectAssetsRequestSchema,
  assetKindFromMime,
  completeUploadRequestSchema,
  createProjectRequestSchema,
  jobStatusSchema,
  jobTypeSchema,
  memberRoleSchema,
  presignUploadRequestSchema,
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
