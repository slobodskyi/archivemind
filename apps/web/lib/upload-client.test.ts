import { SINGLE_PUT_MAX_BYTES } from "@archivemind/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexedUploadFile } from "@/types";
import {
  UPLOAD_COMPLETE_CHUNK_SIZE,
  UPLOAD_COMPLETE_TIMEOUT_MS,
  chunkUploadItems,
  retryProjectLinks,
  runUpload,
  selectUploadFiles,
  uploadCandidates,
} from "./upload-client";

function file(name: string, size = 1): File {
  return new File([new Uint8Array(size)], name, { type: "image/jpeg" });
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

type XhrOutcome = "success" | "network" | "timeout" | { status: number };
let xhrOutcomes: XhrOutcome[] = [];
let xhrUrls: string[] = [];
let xhrTimeouts: number[] = [];

class FakeXMLHttpRequest {
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  status = 0;
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = "";

  open(_method: string, url: string) {
    this.url = url;
  }

  setRequestHeader() {}

  send(body: File) {
    xhrUrls.push(this.url);
    xhrTimeouts.push(this.timeout);
    const outcome = xhrOutcomes.shift() ?? "success";
    queueMicrotask(() => {
      if (outcome === "network") {
        this.onerror?.();
      } else if (outcome === "timeout") {
        this.ontimeout?.();
      } else {
        this.upload.onprogress?.({ loaded: body.size });
        this.status = outcome === "success" ? 200 : outcome.status;
        this.onload?.();
      }
    });
  }
}

function successfulFetch(options: {
  completeBodies?: number[];
  completeProjectIds?: Array<string | undefined>;
  completionIds?: string[];
  serializedCompleteBodies?: string[];
  linkBodies?: number[];
  headers?: Headers[];
} = {}) {
  let presign = 0;
  let complete = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    options.headers?.push(new Headers(init?.headers));
    if (url === "/api/uploads/presign") {
      presign += 1;
      return Response.json({ uploadUrl: `https://r2.test/${presign}`, r2Key: `workspace/originals/${presign}` });
    }
    if (url === "/api/uploads/complete") {
      const serializedBody = String(init?.body);
      const body = JSON.parse(serializedBody) as {
        completionId: string;
        uploads: unknown[];
        projectId?: string;
      };
      options.completeBodies?.push(body.uploads.length);
      options.completeProjectIds?.push(body.projectId);
      options.completionIds?.push(body.completionId);
      options.serializedCompleteBodies?.push(serializedBody);
      complete += 1;
      return Response.json({
        assetIds: body.uploads.map((_, index) => uuid(complete * 1_000 + index + 1)),
        jobId: uuid(900_000 + complete),
      });
    }
    if (url.includes("/api/projects/")) {
      const body = JSON.parse(String(init?.body)) as { assetIds: string[] };
      options.linkBodies?.push(body.assetIds.length);
      return Response.json({ added: body.assetIds.length });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  xhrOutcomes = [];
  xhrUrls = [];
  xhrTimeouts = [];
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("selectUploadFiles", () => {
  it("keeps original input indexes and reports structured skip reasons", () => {
    const oversized = file("oversized.jpg");
    Object.defineProperty(oversized, "size", { value: SINGLE_PUT_MAX_BYTES + 1 });
    const files = [file("valid-a.jpg"), file("empty.jpg", 0), oversized, file("valid-b.jpg")];

    const selection = selectUploadFiles(files);
    expect(selection.candidates.map((item) => item.inputIndex)).toEqual([0, 3]);
    expect(selection.skippedFiles).toEqual([
      { inputIndex: 1, reason: "empty" },
      { inputIndex: 2, reason: "too-large" },
    ]);
  });

  it("keeps the explicit 500-file selection cap and labels overflow", () => {
    const files = Array.from({ length: 502 }, (_, index) => file(`${index}.jpg`));
    const selection = selectUploadFiles(files);

    expect(uploadCandidates(files)).toHaveLength(500);
    expect(selection.candidates[499].inputIndex).toBe(499);
    expect(selection.skippedFiles).toEqual([
      { inputIndex: 500, reason: "batch-limit" },
      { inputIndex: 501, reason: "batch-limit" },
    ]);
  });

  it("preserves caller-provided indexes for retry subsets", () => {
    const retry: IndexedUploadFile[] = [
      { inputIndex: 17, file: file("a.jpg") },
      { inputIndex: 381, file: file("b.jpg") },
    ];
    expect(selectUploadFiles(retry).candidates.map((item) => item.inputIndex)).toEqual([17, 381]);
  });
});

describe("chunkUploadItems", () => {
  it("splits on 100-item boundaries without dropping or reordering", () => {
    for (const count of [0, 1, 99, 100, 101, 500]) {
      const items = Array.from({ length: count }, (_, index) => index);
      const chunks = chunkUploadItems(items);
      expect(chunks.flat()).toEqual(items);
      expect(chunks.every((chunk) => chunk.length <= UPLOAD_COMPLETE_CHUNK_SIZE)).toBe(true);
      expect(chunks).toHaveLength(Math.ceil(count / UPLOAD_COMPLETE_CHUNK_SIZE));
    }
  });

  it("rejects invalid custom sizes", () => {
    expect(() => chunkUploadItems([1], 0)).toThrow("upload chunk size must be positive");
  });
});

describe("runUpload", () => {
  it("completes chunk one before presigning input 100 and carries projectId in every chunk", async () => {
    const completeBodies: number[] = [];
    const completeProjectIds: Array<string | undefined> = [];
    const completionIds: string[] = [];
    const linkBodies: number[] = [];
    const headers: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      successfulFetch({
        completeBodies,
        completeProjectIds,
        completionIds,
        linkBodies,
        headers,
      }),
    );

    const result = await runUpload(
      Array.from({ length: 205 }, (_, index) => file(`${index}.jpg`)),
      { projectId: uuid(7), batchId: "batch-205" },
    );

    expect(completeBodies).toEqual([100, 100, 5]);
    expect(completeProjectIds).toEqual([uuid(7), uuid(7), uuid(7)]);
    expect(new Set(completionIds)).toHaveLength(3);
    expect(completionIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))).toBe(true);
    expect(linkBodies).toEqual([]);
    expect(result.uploaded).toHaveLength(205);
    expect(result.assetIds).toHaveLength(205);
    expect(result.jobIds).toHaveLength(3);
    expect(result.uploaded.slice(0, 100).every((item) => item.jobId === result.jobIds[0])).toBe(true);
    expect(result.uploaded.slice(100, 200).every((item) => item.jobId === result.jobIds[1])).toBe(true);
    expect(result.projectLinkFailedIndexes).toEqual([]);
    expect(result.projectLink).toBe("linked");
    expect(result.failedIndexes).toEqual([]);
    expect(headers.every((header) => header.get("x-archivemind-upload-batch") === "batch-205")).toBe(true);
    expect(headers.some((header) => header.get("x-archivemind-upload-index") === "204")).toBe(true);
    expect(headers.some((header) => header.get("x-archivemind-upload-chunk") === "3/3")).toBe(true);
    const firstCompleteAt = headers.findIndex(
      (header) => header.get("x-archivemind-upload-chunk") === "1/3",
    );
    const input100PresignAt = headers.findIndex(
      (header) => header.get("x-archivemind-upload-index") === "100",
    );
    expect(firstCompleteAt).toBeGreaterThanOrEqual(0);
    expect(firstCompleteAt).toBeLessThan(input100PresignAt);
  });

  it("does not retry a completion conflict and continues later chunks", async () => {
    let completeCall = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/uploads/presign") {
        const index = Number(new Headers(init?.headers).get("x-archivemind-upload-index"));
        return Response.json({ uploadUrl: `https://r2.test/${index}`, r2Key: `workspace/originals/${index}` });
      }
      if (url === "/api/uploads/complete") {
        completeCall += 1;
        if (completeCall === 1) return Response.json({ error: "conflict" }, { status: 409 });
        const body = JSON.parse(String(init?.body)) as { uploads: unknown[] };
        return Response.json({ assetIds: body.uploads.map((_, index) => uuid(index + 1)), jobId: uuid(800_001) });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const result = await runUpload(Array.from({ length: 101 }, (_, index) => file(`${index}.jpg`)));

    expect(completeCall).toBe(2);
    expect(result.failedIndexes).toEqual(Array.from({ length: 100 }, (_, index) => index));
    expect(result.uploaded).toEqual([{ inputIndex: 100, assetId: uuid(1), jobId: uuid(800_001) }]);
  });

  it("does not retry a permanent 400 completion error", async () => {
    let completeCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/uploads/presign") {
        return Response.json({
          uploadUrl: "https://r2.test/permanent",
          r2Key: "workspace/originals/permanent",
        });
      }
      completeCalls += 1;
      return Response.json({ error: "invalid" }, { status: 400 });
    }));

    const result = await runUpload([file("bad-complete.jpg")]);

    expect(completeCalls).toBe(1);
    expect(result.failedIndexes).toEqual([0]);
    expect(result.errors).toEqual(["complete failed (400)"]);
  });

  it("retries a transient completion with the exact same body and completion UUID", async () => {
    let completeCall = 0;
    const bodies: string[] = [];
    const attempts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/uploads/presign") {
        return Response.json({
          uploadUrl: "https://r2.test/one",
          r2Key: "workspace/originals/one",
        });
      }
      if (url === "/api/uploads/complete") {
        completeCall += 1;
        bodies.push(String(init?.body));
        attempts.push(new Headers(init?.headers).get("x-archivemind-upload-attempt") ?? "");
        if (completeCall === 1) return Response.json({ error: "temporary" }, { status: 503 });
        return Response.json({ assetIds: [uuid(1)], jobId: uuid(800_002) });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const result = await runUpload([file("one.jpg")], { batchId: "retry-complete" });

    expect(completeCall).toBe(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]).completionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(attempts).toEqual(["1", "2"]);
    expect(result.failedIndexes).toEqual([]);
    expect(result.uploaded).toEqual([{ inputIndex: 0, assetId: uuid(1), jobId: uuid(800_002) }]);
  });

  it("retries a completion network failure", async () => {
    let completeCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/uploads/presign") {
        return Response.json({
          uploadUrl: "https://r2.test/network",
          r2Key: "workspace/originals/network",
        });
      }
      completeCalls += 1;
      if (completeCalls === 1) throw new TypeError("network disconnected");
      return Response.json({ assetIds: [uuid(1)], jobId: uuid(800_004) });
    }));

    const result = await runUpload([file("network.jpg")]);

    expect(completeCalls).toBe(2);
    expect(result.failedIndexes).toEqual([]);
  });

  it("retries a timed-out completion without blocking later chunks", async () => {
    vi.useFakeTimers();
    let completeCall = 0;
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/uploads/presign") {
        const index = Number(new Headers(init?.headers).get("x-archivemind-upload-index"));
        return Response.json({ uploadUrl: `https://r2.test/${index}`, r2Key: `workspace/originals/${index}` });
      }
      if (url === "/api/uploads/complete") {
        completeCall += 1;
        bodies.push(String(init?.body));
        if (completeCall === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        }
        const body = JSON.parse(String(init?.body)) as { uploads: unknown[] };
        return Response.json({
          assetIds: body.uploads.map((_, index) => uuid(index + 1)),
          jobId: uuid(800_003),
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const pending = runUpload(Array.from({ length: 101 }, (_, index) => file(`${index}.jpg`)));
    await vi.advanceTimersByTimeAsync(UPLOAD_COMPLETE_TIMEOUT_MS + 250);
    const result = await pending;

    expect(completeCall).toBe(3);
    expect(bodies[1]).toBe(bodies[0]);
    expect(result.failedIndexes).toEqual([]);
    expect(result.uploaded).toHaveLength(101);
    expect(result.errors).toEqual([]);
  });

  it("creates a new completion UUID for an explicit retry with the same trace batch", async () => {
    const completionIds: string[] = [];
    const headers: Headers[] = [];
    vi.stubGlobal("fetch", successfulFetch({ completionIds, headers }));

    await runUpload([{ inputIndex: 9, file: file("retry.jpg") }], { batchId: "same-batch" });
    await runUpload([{ inputIndex: 9, file: file("retry.jpg") }], { batchId: "same-batch" });

    expect(completionIds).toHaveLength(2);
    expect(completionIds[1]).not.toBe(completionIds[0]);
    expect(headers.every((header) => header.get("x-archivemind-upload-batch") === "same-batch"))
      .toBe(true);
  });

  it("retries transient presign and PUT failures with the same R2 URL", async () => {
    let presignCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/uploads/presign") {
        presignCalls += 1;
        if (presignCalls === 1) return Response.json({ error: "busy" }, { status: 503 });
        expect(new Headers(init?.headers).get("x-archivemind-upload-attempt")).toBe("2");
        return Response.json({ uploadUrl: "https://r2.test/stable", r2Key: "workspace/originals/stable" });
      }
      if (url === "/api/uploads/complete") {
        return Response.json({ assetIds: [uuid(1)], jobId: uuid(2) });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    xhrOutcomes = ["network", "success"];

    const result = await runUpload([{ inputIndex: 77, file: file("retry.jpg") }], { batchId: "retry-batch" });

    expect(presignCalls).toBe(2);
    expect(xhrUrls).toEqual(["https://r2.test/stable", "https://r2.test/stable"]);
    expect(xhrTimeouts.every((timeout) => timeout >= 120_000 && timeout <= 900_000)).toBe(true);
    expect(result.attemptedIndexes).toEqual([77]);
    expect(result.uploaded[0]).toEqual({ inputIndex: 77, assetId: uuid(1), jobId: uuid(2) });
  });

  it("does not retry permanent presign errors", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "bad request" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runUpload([{ inputIndex: 42, file: file("bad.jpg") }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(xhrUrls).toEqual([]);
    expect(result.attemptedIndexes).toEqual([42]);
    expect(result.failedIndexes).toEqual([42]);
  });

  it("keeps idempotent link-only retry for existing failed memberships", async () => {
    let linkCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/projects/")) {
        linkCalls += 1;
        return Response.json({ error: "busy" }, { status: linkCalls === 1 ? 503 : 400 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const result = await retryProjectLinks(
      [{ inputIndex: 88, assetId: uuid(1), jobId: uuid(2) }],
      { projectId: uuid(7), batchId: "link-batch" },
    );

    expect(linkCalls).toBe(2); // retry 503, stop on permanent 400
    expect(result.failedIndexes).toEqual([88]);
  });

  it("can retry link-only failures without presigning or uploading again", async () => {
    const linkBodies: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/api/projects/");
      const body = JSON.parse(String(init?.body)) as { assetIds: string[] };
      linkBodies.push(body.assetIds.length);
      return Response.json({ added: body.assetIds.length });
    }));
    const uploaded = Array.from({ length: 105 }, (_, index) => ({
      inputIndex: index + 20,
      assetId: uuid(index + 1),
      jobId: uuid(500_000 + index),
    }));

    const result = await retryProjectLinks(uploaded, { projectId: uuid(7), batchId: "link-only" });

    expect(linkBodies).toEqual([50, 50, 5]);
    expect(result).toEqual({ failedIndexes: [], errors: [] });
    expect(xhrUrls).toEqual([]);
  });

  it("keeps a partially matched legacy link chunk retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ added: 1 })));
    const uploaded = [
      { inputIndex: 10, assetId: uuid(1), jobId: uuid(101) },
      { inputIndex: 11, assetId: uuid(2), jobId: uuid(101) },
    ];

    const result = await retryProjectLinks(uploaded, {
      projectId: uuid(7),
      batchId: "partial-link",
    });

    expect(result.failedIndexes).toEqual([10, 11]);
    expect(result.errors).toEqual(["add to project incomplete (1/2)"]);
  });
});
