import { describe, expect, it } from "vitest";
import {
  createProjectShareRequestSchema,
  liveShareCount,
  projectShareMode,
  projectSharePath,
  projectShareRights,
  projectShareRowSchema,
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
  scope: "project",
  board_id: null,
  board_name: null,
  board_color: null,
  file_count: 12,
  show_boards: false,
  show_labels: false,
  show_tags: false,
  caption_lang: null,
  caption_style: null,
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

  it("defaults to a project link, as a browser from before ADR 0053 sends", () => {
    expect(createProjectShareRequestSchema.parse({ mode: "both", expiresInDays: 7 }).scope).toBe("project");
  });

  it("makes each scope name exactly its own target", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const base = { mode: "download", expiresInDays: 7 } as const;
    const ok = (body: object) => createProjectShareRequestSchema.safeParse({ ...base, ...body }).success;
    expect(ok({ scope: "board", boardId: id })).toBe(true);
    expect(ok({ scope: "board" })).toBe(false);
    expect(ok({ scope: "board", boardId: id, assetIds: [id] })).toBe(false);
    expect(ok({ scope: "project", boardId: id })).toBe(false);
    expect(ok({ scope: "selection", assetIds: [id] })).toBe(true);
    expect(ok({ scope: "selection" })).toBe(false);
    expect(ok({ scope: "selection", assetIds: [] })).toBe(false);
    expect(ok({ scope: "selection", assetIds: ["not-a-uuid"] })).toBe(false);
    expect(ok({ scope: "selection", assetIds: Array(2001).fill(id) })).toBe(false);
    expect(ok({ scope: "project", assetIds: [id] })).toBe(false);
    expect(ok({ scope: "everything" })).toBe(false);
  });

  it("refuses a list that could receive files", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    for (const mode of ["upload", "both"]) {
      expect(createProjectShareRequestSchema.safeParse({ mode, expiresInDays: 7, scope: "selection", assetIds: [id] }).success).toBe(false);
    }
    expect(createProjectShareRequestSchema.safeParse({ mode: "both", expiresInDays: 7, scope: "board", boardId: id }).success).toBe(true);
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

  it("carries the scope and the details, narrowing values it does not know", () => {
    const summary = toProjectShareSummary(
      {
        ...row,
        scope: "board",
        board_id: "33333333-3333-4333-8333-333333333333",
        board_name: "Kyiv",
        board_color: "chartreuse",
        file_count: 48,
        show_labels: true,
        caption_lang: "uk",
        caption_style: "agency",
      },
      "/s/x",
    );
    expect(summary).toMatchObject({
      scope: "board",
      boardName: "Kyiv",
      boardColor: null,
      fileCount: 48,
      details: { boards: false, labels: true, tags: false, caption: { lang: "uk", style: "agency" } },
    });
  });

  it("parses a row from before the scopes migration as a project link", () => {
    const parsed = projectShareRowSchema.parse({ ...row, scope: undefined, file_count: undefined });
    expect(parsed.scope).toBe("project");
    expect(toProjectShareSummary(parsed, null).details.caption).toBeNull();
  });

  it("counts live links only", () => {
    const shares = (["live", "expired", "inactive", "live"] as const).map((status) =>
      toProjectShareSummary({ ...row, status }, null),
    );
    expect(liveShareCount(shares)).toBe(2);
  });
});
