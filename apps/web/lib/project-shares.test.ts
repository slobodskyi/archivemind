import { describe, expect, it } from "vitest";
import {
  createProjectShareRequestSchema,
  liveShareCount,
  projectShareMode,
  projectSharePath,
  projectShareRights,
  toProjectShareSummary,
  updateProjectShareRequestSchema,
  type ProjectShareRow,
} from "./project-shares";

const row: ProjectShareRow = {
  id: "11111111-1111-4111-8111-111111111111",
  label: null,
  can_download: true,
  can_upload: false,
  status: "live",
  created_at: "2026-11-03T10:00:00+00:00",
  expires_at: "2026-11-10T10:00:00+00:00",
  created_by: "22222222-2222-4222-8222-222222222222",
  created_by_name: "Oleksandr",
  token_ciphertext: "v1:iv:ct:tag",
  download_count: 2,
  last_opened_at: null,
  last_upload_at: null,
  files_received: 0,
  bytes_received: 0,
  max_files: 2000,
  max_bytes: 21474836480,
};

describe("project share rights", () => {
  it("maps each mode to its rights and back", () => {
    for (const mode of ["download", "upload", "both"] as const) {
      const { canDownload, canUpload } = projectShareRights(mode);
      expect(projectShareMode(canDownload, canUpload)).toBe(mode);
    }
    expect(projectShareRights("upload")).toEqual({ canDownload: false, canUpload: true });
  });
});

describe("createProjectShareRequestSchema", () => {
  it("accepts the four expiries and nothing else — there is no 'never'", () => {
    for (const days of [1, 7, 30, 90]) {
      expect(createProjectShareRequestSchema.safeParse({ mode: "both", expiresInDays: days }).success).toBe(true);
    }
    for (const days of [0, 2, 365, null, "7"]) {
      expect(createProjectShareRequestSchema.safeParse({ mode: "both", expiresInDays: days }).success).toBe(false);
    }
  });

  it("refuses smuggled fields instead of ignoring them", () => {
    const base = { mode: "download", expiresInDays: 7 };
    expect(createProjectShareRequestSchema.safeParse({ ...base, canUpload: true }).success).toBe(false);
    expect(createProjectShareRequestSchema.safeParse({ ...base, tokenHash: "00".repeat(32) }).success).toBe(false);
  });

  it("trims the label and caps it", () => {
    expect(createProjectShareRequestSchema.parse({ mode: "upload", expiresInDays: 1, label: "  Agency  " }).label).toBe("Agency");
    expect(createProjectShareRequestSchema.safeParse({ mode: "upload", expiresInDays: 1, label: "x".repeat(81) }).success).toBe(false);
  });
});

describe("updateProjectShareRequestSchema", () => {
  it("needs something to change", () => {
    expect(updateProjectShareRequestSchema.safeParse({}).success).toBe(false);
    expect(updateProjectShareRequestSchema.safeParse({ expiresInDays: 30 }).success).toBe(true);
    expect(updateProjectShareRequestSchema.safeParse({ label: null }).success).toBe(true);
    expect(updateProjectShareRequestSchema.safeParse({ expiresInDays: 365 }).success).toBe(false);
  });
});

describe("toProjectShareSummary", () => {
  it("never carries the ciphertext to the browser", () => {
    const token = "t".repeat(43);
    const summary = toProjectShareSummary(row, projectSharePath(token));
    expect(JSON.stringify(summary)).not.toContain(row.token_ciphertext);
    expect(summary.path).toBe(`/s/${token}`);
    expect(summary.mode).toBe("download");
  });

  it("drops the path of a link that is not live", () => {
    expect(toProjectShareSummary({ ...row, status: "expired" }, "/s/x").path).toBeNull();
    expect(toProjectShareSummary({ ...row, status: "inactive" }, "/s/x").path).toBeNull();
  });

  it("counts live links only", () => {
    const shares = (["live", "expired", "inactive", "live"] as const).map((status) =>
      toProjectShareSummary({ ...row, status }, null),
    );
    expect(liveShareCount(shares)).toBe(2);
  });
});
