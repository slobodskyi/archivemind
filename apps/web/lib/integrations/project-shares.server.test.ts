import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptToken, parseTokenKey } from "@archivemind/shared/token-crypto";
import { encodeShareCursor } from "../project-share-public";
import { mintShareToken, shareTokenHash } from "../share-token";
import {
  enqueueProjectShareDownload,
  listProjectShareAssets,
  listProjectShareFacets,
  openProjectShare,
  openShareToken,
  projectShareDownloadStatus,
  resolveProjectShareMedia,
  sealShareToken,
} from "./project-shares.server";

const admin = vi.hoisted(() => ({ rpc: vi.fn() }));

// vitest has no `@/` alias: the module under test reaches the real files.
vi.mock("@/lib/share-token", async () => import("../share-token"));
vi.mock("@/lib/project-share-public", async () => import("../project-share-public"));
vi.mock("@/lib/publication-shares", async () => import("../publication-shares"));
vi.mock("@/lib/project-shares", async () => import("../project-shares"));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: admin.rpc }) }));

const key = randomBytes(32).toString("base64");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  admin.rpc.mockReset();
});

describe("project share token custody", () => {
  it("seals a token so only this key opens it", async () => {
    vi.stubEnv("TOKEN_ENC_KEY", key);
    const { token } = await mintShareToken();

    const sealed = sealShareToken(token) ?? "";

    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain(token);
    expect(openShareToken(sealed)).toBe(token);
  });

  it("stores and opens nothing without a key", async () => {
    vi.stubEnv("TOKEN_ENC_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { token } = await mintShareToken();

    expect(sealShareToken(token)).toBeNull();
    expect(openShareToken(encryptToken(token, parseTokenKey(key)))).toBeNull();
  });

  it("refuses a ciphertext sealed under another key", async () => {
    vi.stubEnv("TOKEN_ENC_KEY", key);
    const { token } = await mintShareToken();
    const sealed = sealShareToken(token) ?? "";

    vi.stubEnv("TOKEN_ENC_KEY", randomBytes(32).toString("base64"));

    expect(openShareToken(sealed)).toBeNull();
  });

  it("refuses a plaintext that is not a share token", () => {
    vi.stubEnv("TOKEN_ENC_KEY", key);

    expect(openShareToken(encryptToken("../../etc/passwd", parseTokenKey(key)))).toBeNull();
  });
});

// ── the public resolvers (/s/*) ──────────────────────────────────────────

const assetId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";

/** What `.rpc()` hands back: awaitable for a set, `.maybeSingle()` for a row. */
function answer(result: { data: unknown; error?: { message: string } | null }) {
  const settled = { data: result.data, error: result.error ?? null };
  return {
    maybeSingle: vi.fn().mockResolvedValue(settled),
    then: (resolve: (value: typeof settled) => unknown) => Promise.resolve(settled).then(resolve),
  };
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: assetId,
    kind: "photo",
    filename: "DSC_0001.NEF",
    byte_size: 25_000_000,
    width: 1024,
    height: 683,
    taken_at: null,
    has_preview: true,
    has_original: true,
    sort_at: "2026-10-01T09:30:00.123456+00:00",
    ...overrides,
  };
}

describe("project share public resolvers", () => {
  it("never sends a malformed token to the database", async () => {
    expect(await openProjectShare("not-a-token")).toBeNull();
    expect(await listProjectShareAssets("x".repeat(44), null)).toBeNull();
    expect(await resolveProjectShareMedia("../etc", assetId, "thumb")).toBeNull();
    expect(await enqueueProjectShareDownload("", { asset_ids: [assetId], options: {} as never })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await projectShareDownloadStatus("t", jobId)).toBeNull();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("looks a link up by its digest, never the token itself", async () => {
    const { token } = await mintShareToken();
    admin.rpc.mockReturnValue(answer({ data: null }));
    await openProjectShare(token);
    expect(admin.rpc).toHaveBeenCalledWith("open_project_share", { p_token_hash: await shareTokenHash(token) });
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toContain(token);
  });

  it("hides the file count from an upload-only link", async () => {
    const { token } = await mintShareToken();
    admin.rpc.mockReturnValue(answer({
      data: {
        share_id: assetId,
        project_name: "Odesa 2026",
        can_download: false,
        can_upload: true,
        expires_at: "2026-11-10T00:00:00+00:00",
        rights: { creator: "Olena", credit: null, copyrightNotice: null, usageTerms: null },
        file_count: 12,
      },
    }));
    expect(await openProjectShare(token)).toEqual({
      projectName: "Odesa 2026",
      canDownload: false,
      canUpload: true,
      expiresAt: "2026-11-10T00:00:00+00:00",
      rights: { creator: "Olena", credit: null, copyrightNotice: null, usageTerms: null },
      fileCount: null,
      scope: "project",
      boardName: null,
      details: { boards: false, labels: false, tags: false, caption: null },
    });
  });

  it("reads the details a link shows, and none on an upload-only link (ADR 0053 §3)", async () => {
    const { token } = await mintShareToken();
    const row = (overrides: Record<string, unknown>) =>
      answer({
        data: {
          share_id: assetId,
          project_name: "Odesa 2026",
          can_download: true,
          can_upload: false,
          expires_at: "2026-11-10T00:00:00+00:00",
          rights: { creator: null, credit: null, copyrightNotice: null, usageTerms: null },
          file_count: 4,
          scope: "project",
          show_boards: true,
          show_labels: true,
          show_tags: false,
          caption_lang: "uk",
          caption_style: "archival",
          ...overrides,
        },
      });

    admin.rpc.mockReturnValueOnce(row({}));
    expect((await openProjectShare(token))?.details).toEqual({
      boards: true,
      labels: true,
      tags: false,
      caption: { lang: "uk", style: "archival" },
    });

    // Half a caption is no caption; Workspaces mean nothing on a list.
    admin.rpc.mockReturnValueOnce(row({ scope: "selection", caption_style: null }));
    expect((await openProjectShare(token))?.details).toEqual({ boards: false, labels: true, tags: false, caption: null });

    admin.rpc.mockReturnValueOnce(row({ can_download: false, can_upload: true }));
    expect((await openProjectShare(token))?.details).toEqual({ boards: false, labels: false, tags: false, caption: null });
  });

  it("reads a Workspace link's scope and the Workspace's name", async () => {
    const { token } = await mintShareToken();
    admin.rpc.mockReturnValue(answer({
      data: {
        share_id: assetId,
        project_name: "Odesa 2026",
        can_download: true,
        can_upload: false,
        expires_at: "2026-11-10T00:00:00+00:00",
        rights: { creator: null, credit: null, copyrightNotice: null, usageTerms: null },
        file_count: 4,
        scope: "board",
        board_name: "Port",
        board_color: "blue",
        show_boards: false,
      },
    }));
    expect(await openProjectShare(token)).toMatchObject({ scope: "board", boardName: "Port", fileCount: 4 });
  });

  it("drops a row that does not parse rather than rendering half of it", async () => {
    const { token } = await mintShareToken();
    admin.rpc.mockReturnValue(answer({ data: { project_name: "x", can_download: "yes" } }));
    expect(await openProjectShare(token)).toBeNull();
  });

  it("answers an empty page only while the link can still list files", async () => {
    const { token } = await mintShareToken();
    const opened = (canDownload: boolean) =>
      answer({
        data: {
          share_id: assetId,
          project_name: "Odesa 2026",
          can_download: canDownload,
          can_upload: !canDownload,
          expires_at: "2026-11-10T00:00:00+00:00",
          rights: { creator: null, credit: null, copyrightNotice: null, usageTerms: null },
          file_count: canDownload ? 0 : null,
        },
      });

    // A live download link past its last file: an honest empty page.
    admin.rpc.mockReturnValueOnce(answer({ data: [] })).mockReturnValueOnce(opened(true));
    expect(await listProjectShareAssets(token, null)).toEqual({ files: [], nextCursor: null });

    // The SQL answers a dead link and an upload-only one with no rows too.
    admin.rpc.mockReturnValueOnce(answer({ data: [] })).mockReturnValueOnce(answer({ data: null }));
    expect(await listProjectShareAssets(token, null)).toBeNull();
    admin.rpc.mockReturnValueOnce(answer({ data: [] })).mockReturnValueOnce(opened(false));
    expect(await listProjectShareAssets(token, null)).toBeNull();
  });

  it("pages by (sort_at, id) and offers a cursor only after a full page", async () => {
    const { token } = await mintShareToken();
    admin.rpc.mockReturnValue(answer({ data: [assetRow()] }));
    const short = await listProjectShareAssets(token, null);
    expect(short?.nextCursor).toBeNull();
    expect(short?.files[0]).toEqual({
      id: assetId,
      kind: "photo",
      filename: "DSC_0001.NEF",
      byteSize: 25_000_000,
      width: 1024,
      height: 683,
      takenAt: null,
      hasPreview: true,
      hasOriginal: true,
      label: null,
      tags: null,
      caption: null,
    });

    const full = Array.from({ length: 200 }, (_, i) =>
      assetRow({ id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}` }),
    );
    admin.rpc.mockReturnValue(answer({ data: full }));
    const page = await listProjectShareAssets(token, { sortAt: "2026-10-02T00:00:00+00:00", id: assetId });
    expect(page?.nextCursor).toBe(encodeShareCursor(full[199].sort_at, full[199].id));
    expect(admin.rpc).toHaveBeenLastCalledWith("list_project_share_assets", {
      p_token_hash: await shareTokenHash(token),
      p_before_sort_at: "2026-10-02T00:00:00+00:00",
      p_before_id: assetId,
      p_limit: 200,
      p_board_id: null,
      p_label: null,
      p_tag: null,
    });
  });

  it("filters by the recipient's choice and reads each detail's column", async () => {
    const { token } = await mintShareToken();
    const board = "66666666-6666-4666-8666-666666666666";
    admin.rpc.mockReturnValue(answer({
      data: [
        assetRow({ label: "red", tags: ["harbour", "river"], caption: "Порт уранці." }),
        assetRow({ id: jobId, label: "magenta", tags: null, caption: "   " }),
      ],
    }));

    const page = await listProjectShareAssets(token, null, { board, label: "red", tag: "river" });

    expect(admin.rpc).toHaveBeenCalledWith("list_project_share_assets", expect.objectContaining({
      p_board_id: board,
      p_label: "red",
      p_tag: "river",
    }));
    expect(page?.files.map(({ label, tags, caption }) => ({ label, tags, caption }))).toEqual([
      { label: "red", tags: ["harbour", "river"], caption: "Порт уранці." },
      // A colour this build does not know blanks the dot, not the page.
      { label: null, tags: null, caption: null },
    ]);
  });

  it("turns the resolver's refusal of a filter into the same null as a dead link", async () => {
    const { token } = await mintShareToken();
    admin.rpc.mockReturnValue(answer({ data: null, error: { message: "invalid_project_share_filter" } }));
    expect(await listProjectShareAssets(token, null, { tag: "river" })).toBeNull();
  });

  it("groups the facets by detail and drops a row it cannot read", async () => {
    const { token } = await mintShareToken();
    const board = "66666666-6666-4666-8666-666666666666";
    admin.rpc.mockReturnValue(answer({
      data: [
        { facet: "board", value: board, name: "Port", color: "blue", file_count: 12 },
        { facet: "board", value: "not-a-uuid", name: "Bad", color: null, file_count: 1 },
        { facet: "label", value: "red", name: null, color: "red", file_count: 5 },
        { facet: "label", value: "magenta", name: null, color: "magenta", file_count: 2 },
        { facet: "tag", value: "harbour", name: "harbour", color: null, file_count: 9 },
      ],
    }));

    expect(await listProjectShareFacets(token)).toEqual({
      boards: [{ id: board, name: "Port", color: "blue", count: 12 }],
      labels: [{ label: "red", count: 5 }],
      tags: [{ name: "harbour", count: 9 }],
    });
    expect(admin.rpc).toHaveBeenCalledWith("list_project_share_facets", { p_token_hash: await shareTokenHash(token) });
  });

  it("answers empty facets only while the link can still list files", async () => {
    const { token } = await mintShareToken();
    const opened = answer({
      data: {
        share_id: assetId,
        project_name: "Odesa 2026",
        can_download: true,
        can_upload: false,
        expires_at: "2026-11-10T00:00:00+00:00",
        rights: { creator: null, credit: null, copyrightNotice: null, usageTerms: null },
        file_count: 0,
      },
    });

    admin.rpc.mockReturnValueOnce(answer({ data: [] })).mockReturnValueOnce(opened);
    expect(await listProjectShareFacets(token)).toEqual({ boards: [], labels: [], tags: [] });

    admin.rpc.mockReturnValueOnce(answer({ data: [] })).mockReturnValueOnce(answer({ data: null }));
    expect(await listProjectShareFacets(token)).toBeNull();

    admin.rpc.mockReturnValueOnce(answer({ data: null, error: { message: "boom" } }));
    expect(await listProjectShareFacets(token)).toBeNull();
    expect(await listProjectShareFacets("not-a-token")).toBeNull();
  });

  it("refuses a media request for a non-uuid asset without asking", async () => {
    const { token } = await mintShareToken();
    expect(await resolveProjectShareMedia(token, "../../other", "original")).toBeNull();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["project_share_download_busy", "busy"],
    ["project_share_download_limit", "limit"],
    ["project_share_download_empty", "not_found"],
    ["invalid_project_share_download", "failed"],
    ["connection reset", "failed"],
  ])("maps %s to %s", async (message, reason) => {
    const { token } = await mintShareToken();
    admin.rpc.mockReturnValue(answer({ data: null, error: { message } }));
    expect(await enqueueProjectShareDownload(token, { asset_ids: [assetId], options: {} as never })).toEqual({
      ok: false,
      reason,
    });
  });

  it("collapses the job's error to a coarse code", async () => {
    const { token } = await mintShareToken();
    admin.rpc.mockReturnValue(answer({
      data: { status: "failed", progress: 30, progress_label: "Packing 3/10", title: null, result_key: null, error: "export_too_large" },
    }));
    expect(await projectShareDownloadStatus(token, jobId)).toEqual({
      status: "failed",
      progress: 30,
      error: "too_large",
      title: null,
      resultKey: null,
    });
  });
});
