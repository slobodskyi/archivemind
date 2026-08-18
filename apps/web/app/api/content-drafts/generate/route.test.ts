import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyzeModel: vi.fn(() => "test-model"),
  createClient: vi.fn(),
  getCurrentWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/gemini", () => ({ analyzeModel: mocks.analyzeModel }));
vi.mock("@/lib/content-generation", async () => import("../../../../lib/content-generation"));
vi.mock("@/lib/notes", async () => import("../../../../lib/notes"));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/workspace", () => ({
  getCurrentWorkspaceId: mocks.getCurrentWorkspaceId,
}));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const boardId = "33333333-3333-4333-8333-333333333333";
const firstAssetId = "44444444-4444-4444-8444-444444444444";
const secondAssetId = "55555555-5555-4555-8555-555555555555";

function request(body: unknown) {
  return new Request("http://localhost/api/content-drafts/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: "article",
    boardId,
    sourceAssetIds: [firstAssetId, secondAssetId],
    brief: "Turn this workspace into a concise field note.",
    language: "en",
    tone: "editorial",
    options: { length: "short", imageCount: 1 },
    ...overrides,
  };
}

interface ArrangeOptions {
  user?: { id: string } | null;
  role?: "owner" | "editor" | "viewer" | null;
  boardAssetIds?: string[];
}

/** A deliberately narrow Supabase double: it implements only the query paths
 * reached before source metadata is loaded. That makes an unexpected paid-call
 * path fail loudly instead of silently accepting a broad mock. */
function arrange(options: ArrangeOptions = {}) {
  const from = vi.fn((table: string) => {
    if (table === "memberships") {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: options.role === null ? null : { role: options.role ?? "editor" },
        error: null,
      });
      const secondEq = vi.fn(() => ({ maybeSingle }));
      const firstEq = vi.fn(() => ({ eq: secondEq }));
      return { select: vi.fn(() => ({ eq: firstEq })) };
    }

    if (table === "boards") {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: { id: boardId, workspace_id: workspaceId, project_id: projectId },
        error: null,
      });
      const is = vi.fn(() => ({ maybeSingle }));
      const secondEq = vi.fn(() => ({ is }));
      const firstEq = vi.fn(() => ({ eq: secondEq }));
      return { select: vi.fn(() => ({ eq: firstEq })) };
    }

    if (table === "projects") {
      const maybeSingle = vi.fn().mockResolvedValue({ data: { id: projectId }, error: null });
      const is = vi.fn(() => ({ maybeSingle }));
      const secondEq = vi.fn(() => ({ is }));
      const firstEq = vi.fn(() => ({ eq: secondEq }));
      return { select: vi.fn(() => ({ eq: firstEq })) };
    }

    if (table === "board_assets") {
      const inIds = vi.fn().mockResolvedValue({
        data: (options.boardAssetIds ?? [firstAssetId]).map((asset_id) => ({ asset_id })),
        error: null,
      });
      const eq = vi.fn(() => ({ in: inIds }));
      return { select: vi.fn(() => ({ eq })) };
    }

    throw new Error(`unexpected table access: ${table}`);
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: "user-1" } : options.user },
      }),
    },
    from,
  };
  mocks.createClient.mockResolvedValue(supabase);
  mocks.getCurrentWorkspaceId.mockResolvedValue(workspaceId);
  return { from, supabase };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/content-drafts/generate", () => {
  it("returns 401 before resolving the tenant or touching generation when there is no user", async () => {
    const { from } = arrange({ user: null });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.getCurrentWorkspaceId).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(mocks.analyzeModel).not.toHaveBeenCalled();
  });

  it("rejects an invalid request before resolving tenant state", async () => {
    const { from } = arrange();

    const response = await POST(request(validBody({ sourceAssetIds: [] })));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(mocks.getCurrentWorkspaceId).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(mocks.analyzeModel).not.toHaveBeenCalled();
  });

  it("requires an editor before looking up a board", async () => {
    const { from } = arrange({ role: "viewer" });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "editor_required" });
    expect(from.mock.calls.map(([table]) => table)).toEqual(["memberships"]);
    expect(mocks.analyzeModel).not.toHaveBeenCalled();
  });

  it("rejects the whole selection when even one source is not a member of the board", async () => {
    const { from } = arrange({ boardAssetIds: [firstAssetId] });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "source_assets_not_found" });
    expect(from.mock.calls.map(([table]) => table)).toEqual([
      "memberships",
      "boards",
      "projects",
      "board_assets",
    ]);
    expect(mocks.analyzeModel).not.toHaveBeenCalled();
  });
});
