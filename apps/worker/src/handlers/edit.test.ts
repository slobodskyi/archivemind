import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { HandlerContext } from "./index";

const r2 = vi.hoisted(() => ({
  getObjectBuffer: vi.fn<(key: string) => Promise<Buffer>>(async () => Buffer.from("src")),
  putObject: vi.fn<(key: string, body: Buffer, type: string) => Promise<void>>(async () => {}),
  deleteObject: vi.fn<(key: string) => Promise<void>>(async () => {}),
}));
vi.mock("../services/r2", () => r2);
const render = vi.hoisted(() => ({ sizes: ["thumb", "medium", "large"] as string[] }));
vi.mock("../services/edit-render", () => ({
  renderEditedPreviews: async () => render.sizes.map((size) => ({ size, data: Buffer.alloc(10), width: 1, height: 1 })),
  editPreviewKey: (ws: string, id: string, size: string) => `${ws}/edits/${id}/${size}.webp`,
}));

const { editHandler } = await import("./edit");

const ASSET = "22222222-2222-4222-8222-222222222222";
const RECIPE = { rotate: 90, flipH: false, flipV: false, straighten: 0, crop: null };

function arrange(source: Record<string, unknown> | null, updateRows = 1) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.trimStart().startsWith("select")) return { rows: source ? [source] : [], rowCount: source ? 1 : 0 };
      if (sql.trimStart().startsWith("update asset_edits")) return { rows: [], rowCount: updateRows };
      return { rows: [], rowCount: 1 };
    }),
  };
  const progress = vi.fn(async () => {});
  const run = (payload: Record<string, unknown>) =>
    editHandler({
      pool: pool as unknown as pg.Pool,
      job: { payload: { asset_id: ASSET, ...payload } },
      progress,
    } as unknown as HandlerContext);
  return { queries, run, progress };
}

const row = (extra: Record<string, unknown> = {}) => ({
  workspace_id: "ws",
  medium_key: "ws/previews/a/medium.webp",
  large_key: "ws/previews/a/large.webp",
  stored_recipe: null,
  stored_large_key: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  render.sizes = ["thumb", "medium", "large"];
});

describe("editHandler (ADR 0030, ADR 0055)", () => {
  it("renders from the large preview when there is one and stores all three renders", async () => {
    const { queries, run } = arrange(row());
    await run({ recipe: RECIPE });
    expect(r2.getObjectBuffer).toHaveBeenCalledWith("ws/previews/a/large.webp");
    const upsert = queries.find((q) => q.sql.includes("insert into asset_edits"))!;
    expect(upsert.params).toEqual([
      ASSET,
      JSON.stringify(RECIPE),
      `ws/edits/${ASSET}/thumb.webp`,
      `ws/edits/${ASSET}/medium.webp`,
      10,
      10,
      `ws/edits/${ASSET}/large.webp`,
      10,
    ]);
  });

  it("falls back to medium for a photo with no large preview", async () => {
    render.sizes = ["thumb", "medium"];
    const { queries, run } = arrange(row({ large_key: null }));
    await run({ recipe: RECIPE });
    expect(r2.getObjectBuffer).toHaveBeenCalledWith("ws/previews/a/medium.webp");
    expect(queries.find((q) => q.sql.includes("insert into asset_edits"))!.params.slice(6)).toEqual([null, null]);
  });

  it("removes the previous large render when a tighter crop no longer earns one", async () => {
    render.sizes = ["thumb", "medium"];
    const { run } = arrange(row({ stored_large_key: `ws/edits/${ASSET}/large.webp` }));
    await run({ recipe: RECIPE });
    expect(r2.deleteObject).toHaveBeenCalledWith(`ws/edits/${ASSET}/large.webp`);
  });

  it("a re-render reads the stored recipe and updates only that edit, never upserting", async () => {
    const stored = { ...RECIPE, rotate: 180 };
    const { queries, run } = arrange(row({ stored_recipe: stored }));
    await run({});
    expect(queries.some((q) => q.sql.includes("insert into asset_edits"))).toBe(false);
    const update = queries.find((q) => q.sql.includes("update asset_edits"))!;
    expect(update.sql).toContain("recipe = $2::jsonb");
    expect(update.params[1]).toBe(JSON.stringify(stored));
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });

  it("a re-render whose edit was reset meanwhile throws its renders away", async () => {
    const { run, progress } = arrange(row({ stored_recipe: RECIPE }), 0);
    await run({});
    expect(r2.deleteObject.mock.calls.map((c) => c[0]).sort()).toEqual(
      ["large", "medium", "thumb"].map((s) => `ws/edits/${ASSET}/${s}.webp`),
    );
    expect(progress).toHaveBeenLastCalledWith(100, expect.stringContaining("nothing to re-render"), 1, 1);
  });

  it("a re-render of a photo with no edit does nothing", async () => {
    const { queries, run } = arrange(row());
    await run({});
    expect(r2.getObjectBuffer).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
  });
});
