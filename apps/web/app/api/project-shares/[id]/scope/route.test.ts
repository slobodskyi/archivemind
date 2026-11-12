import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/integrations/project-shares.server", () => ({ openShareToken: vi.fn(), sealShareToken: vi.fn() }));
// vitest has no `@/` alias: the pure modules run for real.
vi.mock("@/lib/project-shares", async () => import("../../../../../lib/project-shares"));
vi.mock("@/lib/project-shares-server", async () => import("../../../../../lib/project-shares-server"));

import { GET } from "./route";

const shareId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";

function arrange(result: { data?: unknown; error?: { code?: string; message?: string } | null }, user: { id: string } | null = { id: "u" }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, rpc });
  return rpc;
}

const ctx = (id = shareId) => ({ params: Promise.resolve({ id }) });
const request = () => new Request(`http://localhost/api/project-shares/${shareId}/scope`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/project-shares/[id]/scope", () => {
  it("lists what the link carries now, no-store", async () => {
    const rpc = arrange({ data: [{ asset_id: assetId }] });
    const response = await GET(request(), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assetIds: [assetId] });
    expect(rpc).toHaveBeenCalledWith("list_project_share_scope", { p_share_id: shareId });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("answers an empty list for a link that carries nothing", async () => {
    arrange({ data: [] });
    const response = await GET(request(), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assetIds: [] });
  });

  it("is 500 when the RPC answers rows it does not recognise", async () => {
    arrange({ data: [{ asset_id: "not-a-uuid" }] });
    expect((await GET(request(), ctx())).status).toBe(500);
  });

  it("is 403 for a viewer — the RPC is editor-only", async () => {
    arrange({ error: { code: "42501", message: "project_share_editor_required" } });
    expect((await GET(request(), ctx())).status).toBe(403);
  });

  it("refuses a malformed id and a signed-out caller", async () => {
    arrange({ data: [] });
    expect((await GET(request(), ctx("nope"))).status).toBe(404);
    arrange({ data: [] }, null);
    expect((await GET(request(), ctx())).status).toBe(401);
  });
});
