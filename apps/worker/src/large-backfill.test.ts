import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

const r2 = vi.hoisted(() => ({
  getObjectBuffer: vi.fn<(key: string) => Promise<Buffer>>(),
  putObject: vi.fn<(key: string, body: Buffer, type: string) => Promise<void>>(async () => {}),
  deleteObject: vi.fn<(key: string) => Promise<void>>(async () => {}),
}));
vi.mock("./services/r2", () => r2);
// The real decoder pulls in heic/exiftool; a JPEG needs none of it.
vi.mock("./handlers/ingest", () => ({
  decodeBytes: async (buf: Buffer) =>
    buf.length === 0 ? { ok: false, reason: "empty" } : { ok: true, input: { kind: "encoded", data: buf } },
}));

const { backfillLargePreviews, largeBackfillPerRun, resetLargeBackfillForTests } = await import("./large-backfill");

const WS = "11111111-1111-4111-8111-111111111111";
const cand = (id: string, extra: Record<string, unknown> = {}) => ({
  asset_id: id,
  workspace_id: WS,
  title: `${id}.jpg`,
  r2_key: `${WS}/originals/${id}/${id}.jpg`,
  mime_type: "image/jpeg",
  edited: false,
  ...extra,
});

/** pg stand-in: the candidate select answers `candidates`, the preview insert
 *  reports `insertRows` (0 = the asset left meanwhile), and the edit enqueue 1. */
function fakePool(candidates: ReturnType<typeof cand>[], insertRows = 1) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("from assets a")) return { rows: candidates, rowCount: candidates.length };
      if (sql.includes("insert into asset_previews")) return { rows: [], rowCount: insertRows };
      if (sql.includes("insert into ai_jobs")) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
  return { pool: pool as unknown as pg.Pool, queries };
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer();
}

beforeEach(() => {
  resetLargeBackfillForTests();
  vi.clearAllMocks();
});

describe("backfillLargePreviews (ADR 0055)", () => {
  it("writes the large preview of a big original and records it while the asset is active", async () => {
    r2.getObjectBuffer.mockResolvedValue(await jpeg(3000, 2000));
    const { pool, queries } = fakePool([cand("a1")]);

    expect(await backfillLargePreviews(pool, { perRun: 10 })).toEqual({ written: 1, skipped: 0, failed: 0, rerenders: 0 });
    expect(r2.getObjectBuffer).toHaveBeenCalledWith(`${WS}/originals/a1/a1.jpg`);
    expect(r2.putObject).toHaveBeenCalledTimes(1);
    expect(r2.putObject.mock.calls[0][0]).toBe(`${WS}/previews/a1/large.webp`);
    const insert = queries.find((q) => q.sql.includes("insert into asset_previews"))!;
    expect(insert.sql).toContain("status = 'active'");
    expect(insert.params.slice(0, 4)).toEqual(["a1", `${WS}/previews/a1/large.webp`, 2048, 1365]);
  });

  it("queues a re-render of an edited photo's edit, with no recipe so it reads the current one", async () => {
    r2.getObjectBuffer.mockResolvedValue(await jpeg(3000, 2000));
    const { pool, queries } = fakePool([cand("a1", { edited: true })]);

    expect((await backfillLargePreviews(pool, { perRun: 10 })).rerenders).toBe(1);
    const job = queries.find((q) => q.sql.includes("insert into ai_jobs"))!;
    expect(job.sql).toContain("'edit'");
    expect(job.sql).toContain("status in ('queued', 'running')");
    expect(JSON.parse(job.params[1] as string)).toEqual({ asset_id: "a1" });
  });

  it("takes back the object when the asset was trashed while it worked", async () => {
    r2.getObjectBuffer.mockResolvedValue(await jpeg(3000, 2000));
    const { pool } = fakePool([cand("a1", { edited: true })], 0);

    expect(await backfillLargePreviews(pool, { perRun: 10 })).toMatchObject({ written: 0, skipped: 1, rerenders: 0 });
    expect(r2.deleteObject).toHaveBeenCalledWith(`${WS}/previews/a1/large.webp`);
  });

  it("settles a small, undecodable or failing original so the next pass moves past it", async () => {
    r2.getObjectBuffer.mockImplementation(async (key: string) => {
      if (key.includes("small")) return jpeg(1024, 768);
      if (key.includes("broken")) return Buffer.alloc(0);
      throw new Error("NoSuchKey");
    });
    const log = vi.fn();
    const { pool, queries } = fakePool([cand("small"), cand("broken"), cand("gone")]);

    expect(await backfillLargePreviews(pool, { perRun: 10, log })).toEqual({ written: 0, skipped: 2, failed: 1, rerenders: 0 });
    expect(r2.putObject).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gone failed"));

    await backfillLargePreviews(pool, { perRun: 10 });
    const second = queries.filter((q) => q.sql.includes("from assets a"))[1];
    expect(new Set(second.params[0] as string[])).toEqual(new Set(["small", "broken", "gone"]));
  });

  it("reads only R2-held originals, never one in a user's cloud", async () => {
    const { pool, queries } = fakePool([]);
    await backfillLargePreviews(pool, { perRun: 10 });
    expect(queries[0].sql).toContain("r2_key is not null");
    expect(queries[0].sql).toContain("'/originals/'");
    expect(queries[0].params[1]).toBe(10);
  });

  it("stops between files when the worker is shutting down, and does nothing when switched off", async () => {
    r2.getObjectBuffer.mockResolvedValue(await jpeg(3000, 2000));
    const { pool } = fakePool([cand("a1"), cand("a2")]);
    let stop = false;
    r2.putObject.mockImplementation(async () => {
      stop = true;
    });
    expect((await backfillLargePreviews(pool, { perRun: 10, shouldStop: () => stop })).written).toBe(1);

    const off = fakePool([cand("a3")]);
    expect(await backfillLargePreviews(off.pool, { perRun: 0 })).toEqual({ written: 0, skipped: 0, failed: 0, rerenders: 0 });
    expect(off.queries).toEqual([]);
  });
});

describe("largeBackfillPerRun", () => {
  it("defaults to 200, honours an explicit 0 and caps a typo'd huge value", () => {
    expect(largeBackfillPerRun(undefined)).toBe(200);
    expect(largeBackfillPerRun("")).toBe(200);
    expect(largeBackfillPerRun("0")).toBe(0);
    expect(largeBackfillPerRun("50")).toBe(50);
    expect(largeBackfillPerRun("999999")).toBe(5000);
    expect(largeBackfillPerRun("lots")).toBe(200);
  });
});
