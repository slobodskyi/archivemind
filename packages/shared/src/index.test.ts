import { describe, expect, it } from "vitest";
import { jobStatusSchema, jobTypeSchema, memberRoleSchema } from "./index";

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
