import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vitest has no `@/` alias: the modules this one composes run for real.
vi.mock("@/lib/project-share-uploads", async () => import("./project-share-uploads"));
vi.mock("@/lib/upload-client", async () => import("./upload-client"));

import { runShareUpload } from "./share-upload-client";

const token = "t".repeat(43);
const ws = "11111111-1111-4111-8111-111111111111";
const rid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

function file(name: string, size = 3, type = "image/jpeg"): File {
  return new File([new Uint8Array(size)], name, { type });
}

let puts: { url: string; contentType: string | null }[] = [];

class FakeXMLHttpRequest {
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  status = 0;
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = "";
  private contentType: string | null = null;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    if (name.toLowerCase() === "content-type") this.contentType = value;
  }
  send(body: File) {
    puts.push({ url: this.url, contentType: this.contentType });
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: body.size });
      this.status = 200;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  puts = [];
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runShareUpload — the share link as an upload transport", () => {
  it("reserves a chunk in ONE request, PUTs each file to its staging URL, completes by reservation id", async () => {
    const presignBodies: { senderName: string | null; files: { filename: string }[] }[] = [];
    const completeBodies: { ids: string[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body));
        if (url === `/s/${token}/uploads/presign`) {
          presignBodies.push(body);
          return Response.json({
            uploads: body.files.map((_: unknown, index: number) => ({
              id: rid(index + 1),
              uploadUrl: `https://r2.test/${ws}/incoming/${rid(index + 1)}?sig=1`,
              contentType: index === 2 ? "application/octet-stream" : "image/jpeg",
            })),
          });
        }
        if (url === `/s/${token}/uploads/complete`) {
          completeBodies.push(body);
          return Response.json({
            received: 2,
            results: [
              { id: rid(1), status: "received" },
              { id: rid(2), status: "received" },
              { id: rid(3), status: "rejected" },
            ],
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const progress: number[] = [];
    const result = await runShareUpload(token, [file("a.jpg"), file("b.jpg"), file("c.heic", 3, "")], {
      senderName: "Olena",
      onProgress: (p) => progress.push(p.progress),
    });

    expect(presignBodies).toHaveLength(1);
    expect(presignBodies[0].senderName).toBe("Olena");
    expect(presignBodies[0].files.map((f) => f.filename)).toEqual(["a.jpg", "b.jpg", "c.heic"]);
    expect(puts.map((p) => p.url).sort()).toEqual([1, 2, 3].map((n) => `https://r2.test/${ws}/incoming/${rid(n)}?sig=1`));
    // The PUT carries exactly the type the server signed, not the browser's guess.
    expect(puts.find((p) => p.url.includes(rid(3)))?.contentType).toBe("application/octet-stream");
    expect(completeBodies).toEqual([{ ids: [rid(1), rid(2), rid(3)] }]);
    expect(result).toMatchObject({ attempted: 3, received: 2, failedIndexes: [2], linkGone: false, quotaReached: false });
    expect(progress.at(-1)).toBe(1);
  });

  it("splits 150 files into two reservations of 100 and 50", async () => {
    const sizes: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (String(input).endsWith("/presign")) {
          const base = sizes.reduce((sum, n) => sum + n, 0);
          sizes.push(body.files.length);
          return Response.json({
            uploads: body.files.map((_: unknown, index: number) => ({
              id: rid(base + index + 1),
              uploadUrl: `https://r2.test/${rid(base + index + 1)}`,
              contentType: "image/jpeg",
            })),
          });
        }
        return Response.json({
          received: body.ids.length,
          results: body.ids.map((id: string) => ({ id, status: "received" })),
        });
      }),
    );

    const result = await runShareUpload(token, Array.from({ length: 150 }, (_, i) => file(`${i}.jpg`)));
    expect(sizes).toEqual([100, 50]);
    expect(result.received).toBe(150);
  });

  it("reports a dead link once, without PUTting anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })));
    const result = await runShareUpload(token, [file("a.jpg"), file("b.jpg")]);
    expect(result).toMatchObject({ received: 0, failedIndexes: [0, 1], linkGone: true, quotaReached: false });
    expect(puts).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a used-up quota", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "quota" }, { status: 413 })));
    const result = await runShareUpload(token, [file("a.jpg")]);
    expect(result).toMatchObject({ received: 0, quotaReached: true, linkGone: false });
  });
});
