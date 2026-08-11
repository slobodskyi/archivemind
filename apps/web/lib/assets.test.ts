import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CANVAS_ASSET_LIMIT, getRealPhotos, getRealPhotoWindow } from "./assets";

interface FakeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

interface FakeResponse {
  data: unknown[] | null;
  error: FakeError | null;
  count: number | null;
}

interface QueryCall {
  method: "from" | "select" | "eq" | "order" | "range";
  args: unknown[];
}

interface FakeBuilder {
  select: (...args: unknown[]) => FakeBuilder;
  eq: (...args: unknown[]) => FakeBuilder;
  order: (...args: unknown[]) => FakeBuilder;
  range: (...args: unknown[]) => Promise<FakeResponse>;
}

function fakeSupabase(responses: FakeResponse[]) {
  const calls: QueryCall[] = [];
  let responseIndex = 0;
  const builder = {} as FakeBuilder;
  builder.select = (...args) => {
    calls.push({ method: "select", args });
    return builder;
  };
  builder.eq = (...args) => {
    calls.push({ method: "eq", args });
    return builder;
  };
  builder.order = (...args) => {
    calls.push({ method: "order", args });
    return builder;
  };
  builder.range = (...args) => {
    calls.push({ method: "range", args });
    const response = responses[responseIndex++];
    if (!response) throw new Error("missing fake Supabase response");
    return Promise.resolve(response);
  };
  const client = {
    from: (...args: unknown[]) => {
      calls.push({ method: "from", args });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function assetRow(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `photo-${index}.jpg`,
    status: "active",
    ai_processed_at: null,
    created_at: "2026-08-11T10:00:00.000Z",
    label: null,
    cluster_id: null,
    topic_clusters: null,
    topic_cluster_overrides: null,
    files: [{ origin: "upload", source_path: null }],
    asset_previews: [],
    asset_exif: null,
    asset_edits: null,
    asset_tags: [],
    facts: [],
    captions: [],
  };
}

describe("getRealPhotoWindow", () => {
  it("returns the bounded newest window with the exact matching total", async () => {
    const rows = Array.from({ length: CANVAS_ASSET_LIMIT }, (_, index) => assetRow(index));
    const { client, calls } = fakeSupabase([{ data: rows, error: null, count: 630 }]);

    const result = await getRealPhotoWindow(client);

    expect(result.photos).toHaveLength(CANVAS_ASSET_LIMIT);
    expect(result.total).toBe(630);
    expect(calls.filter((call) => call.method === "order").map((call) => call.args)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(calls.find((call) => call.method === "range")?.args).toEqual([0, CANVAS_ASSET_LIMIT - 1]);
    expect(calls.find((call) => call.method === "select")?.args[1]).toEqual({ count: "exact" });
  });

  it("keeps the photo-only reader backward compatible", async () => {
    const { client } = fakeSupabase([{ data: [assetRow(1), assetRow(2)], error: null, count: 2 }]);

    const photos = await getRealPhotos(client);

    expect(photos.map((photo) => photo.filename)).toEqual(["photo-1.jpg", "photo-2.jpg"]);
  });

  it("applies project membership scope before the active-asset window", async () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    const { client, calls } = fakeSupabase([{ data: [assetRow(1)], error: null, count: 1 }]);

    await getRealPhotoWindow(client, projectId);

    const select = calls.find((call) => call.method === "select");
    expect(select?.args[0]).toContain("project_assets!inner");
    expect(select?.args[1]).toEqual({ count: "exact" });
    expect(calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
      ["project_assets.project_id", projectId],
      ["status", "active"],
    ]);
  });

  it("preserves the exact count after peeling off both unavailable additive features", async () => {
    const missingLabel: FakeResponse = {
      data: null,
      error: { code: "42703", message: "column assets.label does not exist" },
      count: null,
    };
    const missingOverrides: FakeResponse = {
      data: null,
      error: { code: "PGRST200", message: "topic_cluster_overrides relationship not found" },
      count: null,
    };
    const { client, calls } = fakeSupabase([
      missingLabel,
      missingOverrides,
      { data: [assetRow(1)], error: null, count: 7 },
    ]);

    const result = await getRealPhotoWindow(client);

    expect(result.total).toBe(7);
    expect(result.photos).toHaveLength(1);
    const selects = calls.filter((call) => call.method === "select");
    expect(selects).toHaveLength(3);
    expect(String(selects[0]?.args[0])).toMatch(/^label,/);
    expect(String(selects[1]?.args[0])).not.toMatch(/^label,/);
    expect(String(selects[1]?.args[0])).toContain("topic_cluster_overrides");
    expect(String(selects[2]?.args[0])).not.toContain("topic_cluster_overrides");
    expect(calls.filter((call) => call.method === "range")).toHaveLength(3);
  });
});
