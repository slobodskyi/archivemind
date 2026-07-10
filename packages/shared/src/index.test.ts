import { describe, expect, it } from "vitest";
import {
  SINGLE_PUT_MAX_BYTES,
  assetKindFromMime,
  completeUploadRequestSchema,
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
