import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), presignGet: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/r2", () => ({ presignGet: mocks.presignGet }));
// vitest has no `@/` alias: the pure module runs for real.
vi.mock("@/lib/viewer-originals", async () => import("../../../../../lib/viewer-originals"));

import { GET } from "./route";

const ws = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const key = `${ws}/originals/33333333-3333-4333-8333-333333333333/DSC_0042.jpg`;

type Row = { workspace_id: string; r2_key: string | null; mime_type: string | null; byte_size: number | string | null };

/** A PostgREST builder stand-in: every filter returns the builder, and the
 *  terminal call resolves to the arranged result. Records each call. */
function builder(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "not", "order"]) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(result);
  b.limit = (...args: unknown[]) => {
    calls.push(["limit", args]);
    return Promise.resolve(result);
  };
  return { b, calls };
}

function arrange({
  user = { id: "u" } as { id: string } | null,
  asset = { status: "active" } as { status: string } | null,
  files = [{ workspace_id: ws, r2_key: key, mime_type: "image/jpeg", byte_size: 8_400_000 }] as Row[],
  assetError = null as { message: string } | null,
} = {}) {
  const assets = builder({ data: asset, error: assetError });
  const fileRows = builder({ data: files, error: null });
  const from = vi.fn((table: string) => (table === "assets" ? assets.b : fileRows.b));
  mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, from });
  return { from, fileCalls: fileRows.calls };
}

const ctx = (id = assetId) => ({ params: Promise.resolve({ id }) });
const request = () => new Request(`http://localhost/api/assets/${assetId}/original`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.presignGet.mockResolvedValue("https://r2.example/signed");
});

describe("GET /api/assets/[id]/original", () => {
  it("signs the original inline — no filename, so no attachment — and is no-store", async () => {
    const { fileCalls } = arrange();
    const response = await GET(request(), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://r2.example/signed", mime: "image/jpeg", bytes: 8_400_000 });
    expect(mocks.presignGet).toHaveBeenCalledWith(key);
    expect(response.headers.get("cache-control")).toContain("no-store");
    // The durable copy, oldest first — the ZIP export's own order.
    expect(fileCalls).toContainEqual(["not", ["r2_key", "is", null]]);
    expect(fileCalls).toContainEqual(["order", ["created_at", { ascending: true }]]);
  });

  it("is 401 signed out and 404 for a malformed id, before touching the database", async () => {
    const { from } = arrange({ user: null });
    expect((await GET(request(), ctx())).status).toBe(401);
    expect((await GET(request(), ctx("../../etc"))).status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("is 404 for an asset RLS hides and for a trashed or purged one", async () => {
    arrange({ asset: null });
    expect((await GET(request(), ctx())).status).toBe(404);
    arrange({ asset: { status: "deleted" } });
    expect((await GET(request(), ctx())).status).toBe(404);
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("answers not_stored for a cloud-linked file with no original in R2", async () => {
    arrange({ files: [] });
    expect(await (await GET(request(), ctx())).json()).toEqual({ url: null, reason: "not_stored" });
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("never signs a key outside the workspace's originals/ prefix", async () => {
    for (const r2_key of [
      `${ws}/previews/${assetId}/medium.webp`,
      `${ws}/exports/job.zip`,
      `99999999-9999-4999-8999-999999999999/originals/x/a.jpg`,
      `${ws}/originals`,
    ]) {
      arrange({ files: [{ workspace_id: ws, r2_key, mime_type: "image/jpeg", byte_size: 1 }] });
      expect(await (await GET(request(), ctx())).json()).toEqual({ url: null, reason: "not_stored" });
    }
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("answers format for an original no browser draws, and never signs it", async () => {
    for (const mime_type of ["image/tiff", "image/x-nikon-nef", "image/svg+xml", "text/html"]) {
      arrange({ files: [{ workspace_id: ws, r2_key: key, mime_type, byte_size: 1 }] });
      expect(await (await GET(request(), ctx())).json()).toEqual({ url: null, reason: "format" });
    }
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("reads the format from the key when the client declared none, and parses a string size", async () => {
    arrange({
      files: [{ workspace_id: ws, r2_key: key.replace(".jpg", ".HEIC"), mime_type: null, byte_size: "3100000" }],
    });
    expect(await (await GET(request(), ctx())).json()).toEqual({
      url: "https://r2.example/signed",
      mime: "image/heic",
      bytes: 3_100_000,
    });
  });

  it("is a 500 without the database's message when the read fails", async () => {
    arrange({ assetError: { message: "relation does not exist" } });
    const response = await GET(request(), ctx());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "failed" });
  });
});
