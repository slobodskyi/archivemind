import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserveProjectShareUploads: vi.fn(),
  claimProjectShareUploads: vi.fn(),
  completeProjectShareUploads: vi.fn(),
  presignPut: vi.fn(),
  copyObject: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("@/lib/integrations/project-shares.server", () => ({
  reserveProjectShareUploads: mocks.reserveProjectShareUploads,
  claimProjectShareUploads: mocks.claimProjectShareUploads,
  completeProjectShareUploads: mocks.completeProjectShareUploads,
}));
vi.mock("@/lib/r2", async () => {
  const real = await import("../../../../lib/r2");
  return {
    presignPut: mocks.presignPut,
    copyObject: mocks.copyObject,
    headObject: mocks.headObject,
    deleteObject: mocks.deleteObject,
    isMissingObject: real.isMissingObject,
  };
});
// vitest has no `@/` alias: the pure modules run for real.
vi.mock("@/lib/project-share-http", async () => import("../../../../lib/project-share-http"));
vi.mock("@/lib/project-share-uploads", async () => import("../../../../lib/project-share-uploads"));

import { POST as presign } from "./presign/route";
import { POST as complete } from "./complete/route";

const token = "t".repeat(43);
const ws = "11111111-1111-4111-8111-111111111111";
const r1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const r2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = { params: Promise.resolve({ token }) };

function post(path: string, body: unknown) {
  return new Request(`http://localhost/s/${token}/uploads/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectUniform404(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(response.headers.get("cache-control")).toContain("no-store");
}

function claimed(id: string, declaredBytes = 1000) {
  return {
    id,
    stagingKey: `${ws}/incoming/${id}`,
    finalKey: `${ws}/originals/${id}/IMG.jpg`,
    declaredBytes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.presignPut.mockImplementation(async (key: string) => `https://r2.test/${key}?X-Amz-Signature=s`);
  mocks.copyObject.mockResolvedValue(undefined);
  mocks.deleteObject.mockResolvedValue(undefined);
});

describe("POST /s/{token}/uploads/presign", () => {
  it("sanitises every name, reserves once and signs a PUT to the STAGING key with the declared length", async () => {
    mocks.reserveProjectShareUploads.mockResolvedValue({
      ok: true,
      slots: [
        { id: r1, stagingKey: `${ws}/incoming/${r1}` },
        { id: r2, stagingKey: `${ws}/incoming/${r2}` },
      ],
    });

    const response = await presign(
      post("presign", {
        senderName: "  Olena‮  K. ",
        files: [
          { filename: "../../etc/passwd", mime: "text/plain", size: 10 },
          { filename: "Фото 1.HEIC", mime: "image/HEIC; x=y", size: 2_000 },
        ],
      }),
      ctx,
    );

    expect(response.status).toBe(200);
    const [, sender, items] = mocks.reserveProjectShareUploads.mock.calls[0];
    expect(sender).toBe("Olena K.");
    expect(items).toEqual([
      { filename: "passwd", keyName: "passwd", mime: "text/plain", bytes: 10 },
      { filename: "Фото 1.HEIC", keyName: "_ 1.HEIC", mime: "application/octet-stream", bytes: 2_000 },
    ]);
    expect(mocks.presignPut.mock.calls).toEqual([
      [`${ws}/incoming/${r1}`, "text/plain", { contentLength: 10 }],
      [`${ws}/incoming/${r2}`, "application/octet-stream", { contentLength: 2_000 }],
    ]);
    const body = await response.json();
    expect(body.uploads.map((u: { id: string }) => u.id)).toEqual([r1, r2]);
    expect(JSON.stringify(body)).not.toContain("/originals/");
    expect(body.uploads[1].contentType).toBe("application/octet-stream");
  });

  it("is the same 404 for a dead, unknown or download-only link", async () => {
    mocks.reserveProjectShareUploads.mockResolvedValue({ ok: false, reason: "not_found" });
    await expectUniform404(await presign(post("presign", { files: [{ filename: "a.jpg", mime: "image/jpeg", size: 1 }] }), ctx));
    expect(mocks.presignPut).not.toHaveBeenCalled();
  });

  it("answers a used-up quota as quota, without presigning anything", async () => {
    mocks.reserveProjectShareUploads.mockResolvedValue({ ok: false, reason: "quota" });
    const response = await presign(post("presign", { files: [{ filename: "a.jpg", mime: "image/jpeg", size: 1 }] }), ctx);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "quota" });
    expect(mocks.presignPut).not.toHaveBeenCalled();
  });

  it("refuses more than 100 files, a file over 100 MiB, or none, before touching the database", async () => {
    const one = { filename: "a.jpg", mime: "image/jpeg", size: 1 };
    for (const files of [[], Array.from({ length: 101 }, () => one), [{ ...one, size: 100 * 1024 * 1024 + 1 }]]) {
      const response = await presign(post("presign", { files }), ctx);
      expect(response.status).toBe(400);
    }
    expect(mocks.reserveProjectShareUploads).not.toHaveBeenCalled();
  });
});

describe("POST /s/{token}/uploads/complete", () => {
  it("copies staging → final, measures the FINAL object, completes, then deletes staging last", async () => {
    mocks.claimProjectShareUploads.mockResolvedValue([claimed(r1)]);
    mocks.headObject.mockResolvedValue({ size: 1000 });
    mocks.completeProjectShareUploads.mockResolvedValue({ ok: true, statuses: [{ id: r1, status: "completed" }] });

    const response = await complete(post("complete", { ids: [r1] }), ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: 1, results: [{ id: r1, status: "received" }] });
    expect(mocks.copyObject).toHaveBeenCalledWith(`${ws}/incoming/${r1}`, `${ws}/originals/${r1}/IMG.jpg`);
    expect(mocks.headObject).toHaveBeenCalledWith(`${ws}/originals/${r1}/IMG.jpg`);
    expect(mocks.completeProjectShareUploads).toHaveBeenCalledWith(token, [{ id: r1, ok: true, actualBytes: 1000 }], [r1]);
    expect(mocks.deleteObject.mock.calls).toEqual([[`${ws}/incoming/${r1}`]]);
    // Staging goes only after the asset exists.
    expect(mocks.deleteObject.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.completeProjectShareUploads.mock.invocationCallOrder[0],
    );
  });

  it("rejects a size mismatch and deletes both of its objects", async () => {
    mocks.claimProjectShareUploads.mockResolvedValue([claimed(r1, 1000)]);
    mocks.headObject.mockResolvedValue({ size: 5_000_000 });
    mocks.completeProjectShareUploads.mockResolvedValue({ ok: true, statuses: [{ id: r1, status: "rejected" }] });

    const response = await complete(post("complete", { ids: [r1] }), ctx);

    expect(await response.json()).toEqual({ received: 0, results: [{ id: r1, status: "rejected" }] });
    expect(mocks.completeProjectShareUploads).toHaveBeenCalledWith(token, [{ id: r1, ok: false, actualBytes: 5_000_000 }], [r1]);
    expect(mocks.deleteObject.mock.calls.map(([key]) => key).sort()).toEqual(
      [`${ws}/incoming/${r1}`, `${ws}/originals/${r1}/IMG.jpg`].sort(),
    );
  });

  it("rejects a reservation that was never PUT instead of retrying it forever", async () => {
    mocks.claimProjectShareUploads.mockResolvedValue([claimed(r1)]);
    mocks.copyObject.mockRejectedValue(Object.assign(new Error("missing"), { name: "NoSuchKey" }));
    mocks.completeProjectShareUploads.mockResolvedValue({ ok: true, statuses: [{ id: r1, status: "rejected" }] });

    await complete(post("complete", { ids: [r1] }), ctx);
    expect(mocks.completeProjectShareUploads).toHaveBeenCalledWith(token, [{ id: r1, ok: false, actualBytes: null }], [r1]);
  });

  it("leaves a reservation R2 could not be asked about claimed, and tells the sender to send it again", async () => {
    mocks.claimProjectShareUploads.mockResolvedValue([claimed(r1), claimed(r2)]);
    mocks.copyObject.mockImplementation(async (from: string) => {
      if (from.endsWith(r2)) throw new Error("r2 timeout");
    });
    mocks.headObject.mockResolvedValue({ size: 1000 });
    mocks.completeProjectShareUploads.mockResolvedValue({
      ok: true,
      statuses: [{ id: r1, status: "completed" }, { id: r2, status: "finalizing" }],
    });

    const response = await complete(post("complete", { ids: [r1, r2] }), ctx);
    expect(await response.json()).toEqual({
      received: 1,
      results: [{ id: r1, status: "received" }, { id: r2, status: "pending" }],
    });
    expect(mocks.completeProjectShareUploads.mock.calls[0][1]).toEqual([{ id: r1, ok: true, actualBytes: 1000 }]);
    expect(mocks.deleteObject.mock.calls).toEqual([[`${ws}/incoming/${r1}`]]);
  });

  it("loses the claim race without copying: the winner's outcome is what the loser reports", async () => {
    // Two requests for the same reservation; the database lets one claim it.
    mocks.claimProjectShareUploads.mockResolvedValueOnce([claimed(r1)]).mockResolvedValueOnce([]);
    mocks.headObject.mockResolvedValue({ size: 1000 });
    mocks.completeProjectShareUploads.mockResolvedValue({ ok: true, statuses: [{ id: r1, status: "completed" }] });

    const [first, second] = await Promise.all([
      complete(post("complete", { ids: [r1] }), ctx),
      complete(post("complete", { ids: [r1] }), ctx),
    ]);

    expect(mocks.copyObject).toHaveBeenCalledTimes(1);
    expect(await first.json()).toEqual({ received: 1, results: [{ id: r1, status: "received" }] });
    expect(await second.json()).toEqual({ received: 1, results: [{ id: r1, status: "received" }] });
    // The loser completed with nothing of its own to record.
    expect(mocks.completeProjectShareUploads.mock.calls.map((call) => call[1])).toContainEqual([]);
  });

  it("answers a repeated complete from the ledger without copying, deleting or making anything again", async () => {
    mocks.claimProjectShareUploads.mockResolvedValue([]);
    mocks.completeProjectShareUploads.mockResolvedValue({ ok: true, statuses: [{ id: r1, status: "completed" }] });

    const response = await complete(post("complete", { ids: [r1] }), ctx);

    expect(await response.json()).toEqual({ received: 1, results: [{ id: r1, status: "received" }] });
    expect(mocks.copyObject).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("is the same 404 for a dead link, and for ids that are not this link's", async () => {
    mocks.claimProjectShareUploads.mockResolvedValue([]);
    mocks.completeProjectShareUploads.mockResolvedValue({ ok: false, reason: "not_found" });
    await expectUniform404(await complete(post("complete", { ids: [r1] }), ctx));
    expect(mocks.copyObject).not.toHaveBeenCalled();
  });

  it("never sends an asset id, a key or a dedup outcome back", async () => {
    mocks.claimProjectShareUploads.mockResolvedValue([claimed(r1)]);
    mocks.headObject.mockResolvedValue({ size: 1000 });
    mocks.completeProjectShareUploads.mockResolvedValue({ ok: true, statuses: [{ id: r1, status: "completed" }] });

    const text = await (await complete(post("complete", { ids: [r1] }), ctx)).text();
    expect(text).not.toContain(ws);
    expect(text).not.toMatch(/asset|dedup|merge|originals|incoming/i);
  });

  it("refuses a malformed body or duplicate ids before claiming", async () => {
    for (const body of [{ ids: [] }, { ids: ["nope"] }, { ids: [r1, r1] }, {}]) {
      expect((await complete(post("complete", body), ctx)).status).toBe(400);
    }
    expect(mocks.claimProjectShareUploads).not.toHaveBeenCalled();
  });
});
