import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/integrations/project-shares.server", () => ({ openShareToken: vi.fn(), sealShareToken: vi.fn() }));
// vitest has no `@/` alias: the pure modules run for real.
vi.mock("@/lib/project-shares", async () => import("../../../../../lib/project-shares"));
vi.mock("@/lib/project-shares-server", async () => import("../../../../../lib/project-shares-server"));

import { boardShareCountsResponseSchema } from "../../../../../lib/project-shares";
import { GET } from "./route";

const projectId = "11111111-1111-4111-8111-111111111111";
const boardA = "22222222-2222-4222-8222-222222222222";
const boardB = "55555555-5555-4555-8555-555555555555";

function arrange(result: { data?: unknown; error?: { code?: string; message?: string } | null }, user: { id: string } | null = { id: "u" }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, rpc });
  return rpc;
}

const ctx = (id = projectId) => ({ params: Promise.resolve({ id }) });
const request = () => new Request(`http://localhost/api/projects/${projectId}/board-shares`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/projects/[id]/board-shares", () => {
  it("maps each Workspace to its live-link count, no-store", async () => {
    const rpc = arrange({ data: [{ board_id: boardA, live_count: 2 }, { board_id: boardB, live_count: 1 }] });
    const response = await GET(request(), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ counts: { [boardA]: 2, [boardB]: 1 } });
    // The client parses exactly this shape.
    expect(boardShareCountsResponseSchema.safeParse(body).success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("list_board_share_counts", { p_project_id: projectId });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("leaves a zero count out, so a chip with none is simply absent", async () => {
    arrange({ data: [{ board_id: boardA, live_count: 0 }] });
    expect(await (await GET(request(), ctx())).json()).toEqual({ counts: {} });
  });

  it("answers an empty map for a project with no Workspace links", async () => {
    arrange({ data: [] });
    expect(await (await GET(request(), ctx())).json()).toEqual({ counts: {} });
  });

  it("is 403 when the RPC refuses the caller", async () => {
    arrange({ error: { code: "42501", message: "project_share_member_required" } });
    expect((await GET(request(), ctx())).status).toBe(403);
  });

  it("is 500 on rows it does not recognise", async () => {
    arrange({ data: [{ board_id: "nope", live_count: 1 }] });
    expect((await GET(request(), ctx())).status).toBe(500);
  });

  it("refuses a malformed id without asking the database, and a signed-out caller", async () => {
    const rpc = arrange({ data: [] });
    expect((await GET(request(), ctx("all"))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    arrange({ data: [] }, null);
    expect((await GET(request(), ctx())).status).toBe(401);
  });
});
