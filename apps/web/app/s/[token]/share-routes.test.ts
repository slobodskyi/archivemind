import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openProjectShare: vi.fn(),
  listProjectShareAssets: vi.fn(),
  resolveProjectShareMedia: vi.fn(),
  enqueueProjectShareDownload: vi.fn(),
  projectShareDownloadStatus: vi.fn(),
  presignGet: vi.fn(),
}));

vi.mock("@/lib/integrations/project-shares.server", () => ({
  openProjectShare: mocks.openProjectShare,
  listProjectShareAssets: mocks.listProjectShareAssets,
  resolveProjectShareMedia: mocks.resolveProjectShareMedia,
  enqueueProjectShareDownload: mocks.enqueueProjectShareDownload,
  projectShareDownloadStatus: mocks.projectShareDownloadStatus,
}));
vi.mock("@/lib/r2", () => ({ presignGet: mocks.presignGet }));
// vitest has no `@/` alias: the pure modules run for real.
vi.mock("@/lib/project-share-public", async () => import("../../../lib/project-share-public"));
vi.mock("@/lib/project-share-http", async () => import("../../../lib/project-share-http"));

import { encodeShareCursor } from "../../../lib/project-share-public";
import { GET as listAssets } from "./assets/route";
import { GET as media } from "./media/[assetId]/[variant]/route";
import { POST as requestZip } from "./downloads/route";
import { GET as zipStatus } from "./downloads/[jobId]/route";

const token = "t".repeat(43);
const assetId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const presigned = "https://bucket.r2.example/key?X-Amz-Signature=abc";

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

function zipRequest(body: unknown) {
  return new Request(`http://localhost/s/${token}/downloads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const downloadShare = {
  projectName: "Odesa 2026",
  canDownload: true,
  canUpload: false,
  expiresAt: "2026-11-10T00:00:00+00:00",
  rights: { creator: null, credit: null, copyrightNotice: null, usageTerms: null },
  fileCount: 3,
  scope: "project" as const,
  boardName: null,
};

async function expectUniform404(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("location")).toBeNull();
}

beforeEach(() => {
  mocks.presignGet.mockResolvedValue(presigned);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /s/{token}/media/{assetId}/{variant}", () => {
  it("302s to a 5-minute presign of the original, signed as an attachment", async () => {
    mocks.resolveProjectShareMedia.mockResolvedValue({
      key: "ws/originals/x/DSC_0001.NEF",
      filename: "DSC_0001.NEF",
      quality: "original",
    });
    const response = await media(new Request("http://localhost"), ctx({ token, assetId, variant: "original" }));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(presigned);
    expect(response.headers.get("cache-control")).toBe("private, max-age=240");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.resolveProjectShareMedia).toHaveBeenCalledWith(token, assetId, "original");
    expect(mocks.presignGet).toHaveBeenCalledWith("ws/originals/x/DSC_0001.NEF", "DSC_0001.NEF", { ttlSeconds: 300 });
  });

  it("downloads a Drive file's web-size stand-in as an attachment too", async () => {
    mocks.resolveProjectShareMedia.mockResolvedValue({
      key: "ws/previews/x/medium.webp",
      filename: "DSC_0001.webp",
      quality: "web",
    });
    await media(new Request("http://localhost"), ctx({ token, assetId, variant: "original" }));
    expect(mocks.presignGet).toHaveBeenCalledWith("ws/previews/x/medium.webp", "DSC_0001.webp", { ttlSeconds: 300 });
  });

  it("serves a preview inline: no attachment name is signed", async () => {
    mocks.resolveProjectShareMedia.mockResolvedValue({ key: "ws/previews/x/thumb.webp", filename: "a.jpg", quality: "preview" });
    const response = await media(new Request("http://localhost"), ctx({ token, assetId, variant: "thumb" }));
    expect(response.status).toBe(302);
    expect(mocks.presignGet).toHaveBeenCalledWith("ws/previews/x/thumb.webp", undefined, { ttlSeconds: 300 });
  });

  it("is the same 404 for an unknown variant, without asking the database", async () => {
    await expectUniform404(await media(new Request("http://localhost"), ctx({ token, assetId, variant: "raw" })));
    expect(mocks.resolveProjectShareMedia).not.toHaveBeenCalled();
  });

  // Bad token shape, unknown, revoked, expired, an upload-only link, an asset
  // of another project: the resolver answers null for all of them.
  it("is the same 404 for every refusal the resolver makes", async () => {
    mocks.resolveProjectShareMedia.mockResolvedValue(null);
    await expectUniform404(await media(new Request("http://localhost"), ctx({ token: "short", assetId, variant: "thumb" })));
    await expectUniform404(await media(new Request("http://localhost"), ctx({ token, assetId, variant: "original" })));
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("is the same 404 when signing fails", async () => {
    mocks.resolveProjectShareMedia.mockResolvedValue({ key: "k", filename: "a.jpg", quality: "original" });
    mocks.presignGet.mockRejectedValue(new Error("R2 down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectUniform404(await media(new Request("http://localhost"), ctx({ token, assetId, variant: "original" })));
  });
});

describe("GET /s/{token}/assets", () => {
  it("passes the decoded keyset cursor through and answers no-store JSON", async () => {
    const page = { files: [], nextCursor: null };
    mocks.listProjectShareAssets.mockResolvedValue(page);
    const sortAt = "2026-10-01T09:30:00.123456+00:00";
    const cursor = encodeShareCursor(sortAt, assetId);

    const response = await listAssets(
      new Request(`http://localhost/s/${token}/assets?cursor=${cursor}`),
      ctx({ token }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(response.headers.get("cache-control")).toContain("no-store");
    // The microseconds survive: a rounded cursor would skip or repeat a file.
    expect(mocks.listProjectShareAssets).toHaveBeenCalledWith(token, { sortAt, id: assetId }, {});
  });

  it("asks for the first page without a cursor", async () => {
    mocks.listProjectShareAssets.mockResolvedValue({ files: [], nextCursor: null });
    await listAssets(new Request(`http://localhost/s/${token}/assets`), ctx({ token }));
    expect(mocks.listProjectShareAssets).toHaveBeenCalledWith(token, null, {});
  });

  it("passes a Workspace, colour and tag filter beside the cursor (ADR 0053 §4)", async () => {
    mocks.listProjectShareAssets.mockResolvedValue({ files: [], nextCursor: null });
    const board = "66666666-6666-4666-8666-666666666666";
    const cursor = encodeShareCursor("2026-10-01T09:30:00+00:00", assetId);

    const response = await listAssets(
      new Request(`http://localhost/s/${token}/assets?cursor=${cursor}&board=${board.toUpperCase()}&label=red&tag=${encodeURIComponent("river bank")}`),
      ctx({ token }),
    );

    expect(response.status).toBe(200);
    expect(mocks.listProjectShareAssets).toHaveBeenCalledWith(
      token,
      { sortAt: "2026-10-01T09:30:00+00:00", id: assetId },
      { board, label: "red", tag: "river bank" },
    );
  });

  it("treats an empty filter parameter as no filter", async () => {
    mocks.listProjectShareAssets.mockResolvedValue({ files: [], nextCursor: null });
    await listAssets(new Request(`http://localhost/s/${token}/assets?board=&label=&tag=`), ctx({ token }));
    expect(mocks.listProjectShareAssets).toHaveBeenCalledWith(token, null, {});
  });

  it.each([
    ["a board that is not a uuid", "board=kyiv"],
    ["a colour outside the seven", "label=pink"],
    ["an over-long tag", `tag=${"x".repeat(201)}`],
    ["a tag with a control character", "tag=a%00b"],
  ])("refuses %s with the same 404, before the database", async (_name, query) => {
    await expectUniform404(await listAssets(new Request(`http://localhost/s/${token}/assets?${query}`), ctx({ token })));
    expect(mocks.listProjectShareAssets).not.toHaveBeenCalled();
  });

  it("is the same 404 for a filter on a detail the link does not show", async () => {
    // The resolver's 22023 invalid_project_share_filter reaches the route as null.
    mocks.listProjectShareAssets.mockResolvedValue(null);
    await expectUniform404(await listAssets(new Request(`http://localhost/s/${token}/assets?tag=river`), ctx({ token })));
  });

  it("refuses a forged cursor with the same 404", async () => {
    await expectUniform404(
      await listAssets(new Request(`http://localhost/s/${token}/assets?cursor=not-a-cursor`), ctx({ token })),
    );
    expect(mocks.listProjectShareAssets).not.toHaveBeenCalled();
  });

  it("is the same 404 for an upload-only or dead link", async () => {
    mocks.listProjectShareAssets.mockResolvedValue(null);
    await expectUniform404(await listAssets(new Request(`http://localhost/s/${token}/assets`), ctx({ token })));
  });
});

describe("POST /s/{token}/downloads", () => {
  it("queues a ZIP through the shared export contract, titled by the project", async () => {
    mocks.openProjectShare.mockResolvedValue(downloadShare);
    mocks.enqueueProjectShareDownload.mockResolvedValue({ ok: true, jobId, reused: false });

    const response = await requestZip(zipRequest({ assetIds: [assetId] }), ctx({ token }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ jobId });

    const [sentToken, payload] = mocks.enqueueProjectShareDownload.mock.calls[0];
    expect(sentToken).toBe(token);
    expect(payload).toMatchObject({
      asset_ids: [assetId],
      title: "Odesa 2026",
      options: { format: "zip", zipContents: "originals" },
    });
    // share_id is the resolver's to stamp, never the request's.
    expect(payload).not.toHaveProperty("share_id");
  });

  it("refuses an upload-only link before anything is queued", async () => {
    mocks.openProjectShare.mockResolvedValue({ ...downloadShare, canDownload: false, canUpload: true, fileCount: null });
    await expectUniform404(await requestZip(zipRequest({ assetIds: [assetId] }), ctx({ token })));
    expect(mocks.enqueueProjectShareDownload).not.toHaveBeenCalled();
  });

  it("is the same 404 for a dead link and for ids of another project", async () => {
    mocks.openProjectShare.mockResolvedValueOnce(null);
    await expectUniform404(await requestZip(zipRequest({ assetIds: [assetId] }), ctx({ token })));

    mocks.openProjectShare.mockResolvedValueOnce(downloadShare);
    mocks.enqueueProjectShareDownload.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expectUniform404(await requestZip(zipRequest({ assetIds: [assetId] }), ctx({ token })));
  });

  it.each([
    ["busy", 429, { error: "busy" }],
    ["limit", 429, { error: "limit" }],
    ["failed", 503, { error: "failed" }],
  ] as const)("maps the %s guard to a coarse answer", async (reason, status, body) => {
    mocks.openProjectShare.mockResolvedValue(downloadShare);
    mocks.enqueueProjectShareDownload.mockResolvedValue({ ok: false, reason });
    const response = await requestZip(zipRequest({ assetIds: [assetId] }), ctx({ token }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it("refuses more than 500 ids, or none, before touching the database", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`);
    expect((await requestZip(zipRequest({ assetIds: ids }), ctx({ token }))).status).toBe(400);
    expect((await requestZip(zipRequest({ assetIds: [] }), ctx({ token }))).status).toBe(400);
    expect((await requestZip(zipRequest({ assetIds: ["nope"] }), ctx({ token }))).status).toBe(400);
    expect(mocks.openProjectShare).not.toHaveBeenCalled();
  });
});

describe("GET /s/{token}/downloads/{jobId}", () => {
  it("reports progress as no-store JSON while the ZIP builds", async () => {
    mocks.projectShareDownloadStatus.mockResolvedValue({
      status: "running",
      progress: 40,
      error: null,
      title: "Odesa 2026",
      resultKey: null,
    });
    const response = await zipStatus(new Request("http://localhost"), ctx({ token, jobId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "running", progress: 40, error: null });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("302s to a 5-minute presign of the archive once done, never cached", async () => {
    mocks.projectShareDownloadStatus.mockResolvedValue({
      status: "done",
      progress: 100,
      error: null,
      title: "Odesa 2026",
      resultKey: "ws/exports/job.zip",
    });
    const response = await zipStatus(new Request("http://localhost"), ctx({ token, jobId }));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(presigned);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const [key, filename, options] = mocks.presignGet.mock.calls[0];
    expect(key).toBe("ws/exports/job.zip");
    expect(filename).toMatch(/^odesa-2026-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(options).toEqual({ ttlSeconds: 300 });
  });

  it("reads a swept archive as a failure to retry, not a dead link", async () => {
    mocks.projectShareDownloadStatus.mockResolvedValue({
      status: "done",
      progress: 100,
      error: null,
      title: null,
      resultKey: null,
    });
    const response = await zipStatus(new Request("http://localhost"), ctx({ token, jobId }));
    expect(await response.json()).toEqual({ status: "failed", progress: 0, error: "failed" });
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("is the same 404 for another link's job, a dead link or an upload-only link", async () => {
    mocks.projectShareDownloadStatus.mockResolvedValue(null);
    await expectUniform404(await zipStatus(new Request("http://localhost"), ctx({ token, jobId })));
  });
});
