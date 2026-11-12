import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), presignGet: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/r2", () => ({ presignGet: mocks.presignGet }));

import { GET } from "./route";

const assetId = "22222222-2222-4222-8222-222222222222";

/** A PostgREST builder stand-in: filters return the builder, maybeSingle
 *  resolves to the arranged row. Records each eq() so the size can be read. */
function builder(data: unknown) {
  const eqs: Array<[string, unknown]> = [];
  const b: Record<string, (...args: unknown[]) => unknown> = {
    select: () => b,
    eq: (col: unknown, value: unknown) => {
      eqs.push([col as string, value]);
      return b;
    },
    maybeSingle: () => Promise.resolve({ data, error: null }),
  };
  return { b, eqs };
}

function arrange({
  edit = null as { edited_medium_key: string | null; edited_large_key: string | null } | null,
  preview = { r2_key: "ws/previews/a/x.webp" } as { r2_key: string } | null,
} = {}) {
  const edits = builder(edit);
  const previews = builder(preview);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u" } } }) },
    from: (table: string) => (table === "asset_edits" ? edits.b : previews.b),
  });
  return { previewEqs: previews.eqs };
}

const get = (query = "") =>
  GET(new Request(`http://localhost/api/assets/${assetId}/medium${query}`), {
    params: Promise.resolve({ id: assetId }),
  }).then((r) => r.json());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.presignGet.mockImplementation(async (key: string) => `https://r2.example/${key}`);
});

describe("GET /api/assets/[id]/medium", () => {
  it("serves the medium preview, the edited one when there is an edit", async () => {
    const { previewEqs } = arrange();
    expect(await get()).toEqual({ url: "https://r2.example/ws/previews/a/x.webp" });
    expect(previewEqs).toContainEqual(["size", "medium"]);
    arrange({ edit: { edited_medium_key: "ws/edits/a/medium.webp", edited_large_key: null } });
    expect(await get()).toEqual({ url: "https://r2.example/ws/edits/a/medium.webp" });
  });

  it("?size=large serves the 2048 px preview of an unedited photo, or null when it has none", async () => {
    const { previewEqs } = arrange();
    await get("?size=large");
    expect(previewEqs).toContainEqual(["size", "large"]);
    arrange({ preview: null });
    expect(await get("?size=large")).toEqual({ url: null });
  });

  it("?size=large serves an edited photo's large render — and never its unedited large preview", async () => {
    arrange({ edit: { edited_medium_key: "ws/edits/a/medium.webp", edited_large_key: "ws/edits/a/large.webp" } });
    expect(await get("?size=large")).toEqual({ url: "https://r2.example/ws/edits/a/large.webp" });

    const { previewEqs } = arrange({ edit: { edited_medium_key: "ws/edits/a/medium.webp", edited_large_key: null } });
    expect(await get("?size=large")).toEqual({ url: null });
    expect(previewEqs).toEqual([]);
  });

  it("?size=large&original=1 skips the edit, as the plain original=1 always has", async () => {
    const { previewEqs } = arrange({ edit: { edited_medium_key: "m", edited_large_key: "l" } });
    expect(await get("?size=large&original=1")).toEqual({ url: "https://r2.example/ws/previews/a/x.webp" });
    expect(previewEqs).toContainEqual(["size", "large"]);
  });

  it("only knows two sizes — anything else is the medium", async () => {
    const { previewEqs } = arrange();
    await get("?size=original");
    expect(previewEqs).toContainEqual(["size", "medium"]);
  });
});
