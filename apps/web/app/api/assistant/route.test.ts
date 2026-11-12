import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  workspaceId: vi.fn(),
  parse: vi.fn(),
  embed: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/workspace", () => ({ getCurrentWorkspaceId: mocks.workspaceId }));
vi.mock("@/lib/gemini", () => ({
  parseAssistantMessage: mocks.parse,
  embedText: mocks.embed,
  analyzeModel: () => "test-model",
}));
// vitest has no `@/` alias: the pure modules run for real.
vi.mock("@/lib/search-server", async () => import("../../../lib/search-server"));
vi.mock("@/lib/search-tiers", async () => import("../../../lib/search-tiers"));

import { POST } from "./route";

const projectId = "11111111-1111-4111-8111-111111111111";
const assetId = "44444444-4444-4444-8444-444444444444";

const PARSED = {
  semantic_text: "dogs",
  date_from: null,
  date_to: null,
  place_terms: [],
  tag_terms: ["dog"],
  camera_terms: [],
  iso_min: null,
  iso_max: null,
  aperture: null,
  kinds: [],
};

function arrange(user: { id: string } | null = { id: "u1" }) {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ asset_id: assetId, similarity: 0.8, matched_tags: ["dog"], matched_place: null, matched_text: false, taken_at: null }],
    error: null,
  });
  const insert = vi.fn().mockResolvedValue({ error: null });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    rpc,
    from: vi.fn(() => ({ insert })),
  });
  mocks.workspaceId.mockResolvedValue("ws1");
  mocks.embed.mockResolvedValue([0.1, 0.2]);
  return { rpc, insert };
}

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => vi.clearAllMocks());

describe("POST /api/assistant", () => {
  it("answers a pure command without touching the search pipeline", async () => {
    const { rpc, insert } = arrange();
    mocks.parse.mockResolvedValue({
      intent: { action: "open_view", target: "all", view: "map" },
      parsed: { ...PARSED, semantic_text: "", tag_terms: [] },
    });
    const response = await post({ message: "show the map", projectId });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.intent).toEqual({ action: "open_view", target: "all", view: "map" });
    expect(json.results).toBeNull();
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    // No event type exists for a command, and it is not a search.
    expect(insert).not.toHaveBeenCalled();
  });

  it("runs a search for a search, scoped to the project, and logs it", async () => {
    const { rpc, insert } = arrange();
    mocks.parse.mockResolvedValue({ intent: { action: "search", target: "new_search" }, parsed: PARSED });
    const response = await post({ message: "dogs", projectId });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.results).toEqual([
      { assetId, similarity: 0.8, tier: "strong", matchedTags: ["dog"], matchedPlace: null, matchedText: false, takenAt: null },
    ]);
    expect(mocks.embed).toHaveBeenCalledWith("dogs");
    expect(rpc).toHaveBeenCalledWith("search_assets", expect.objectContaining({ ws: "ws1", proj: projectId, tag_terms: ["dog"] }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: "search_query", workspace_id: "ws1", user_id: "u1" }));
  });

  it("searches for the photos a command describes, and keeps the command", async () => {
    const { rpc } = arrange();
    mocks.parse.mockResolvedValue({
      intent: { action: "add_to_workspace", target: "new_search", workspace_name: "Pets" },
      parsed: PARSED,
    });
    const json = await (await post({ message: "add the dog photos to Pets" })).json();
    expect(json.intent).toEqual({ action: "add_to_workspace", target: "new_search", workspace_name: "Pets" });
    expect(json.results).toHaveLength(1);
    // No projectId sent: the whole workspace, as on the all-files canvas.
    expect(rpc).toHaveBeenCalledWith("search_assets", expect.objectContaining({ proj: undefined }));
  });

  it("does not search when the command is about photos already on screen", async () => {
    const { rpc } = arrange();
    mocks.parse.mockResolvedValue({
      intent: { action: "add_to_workspace", target: "last_results", workspace_name: "Pets" },
      parsed: { ...PARSED, semantic_text: "" },
    });
    const json = await (await post({ message: "add these to Pets", context: { hasResults: true } })).json();
    expect(json.results).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hands the parser the context it was sent, and nothing it was not", async () => {
    arrange();
    mocks.parse.mockResolvedValue({ intent: { action: "help", target: "all" }, parsed: PARSED });
    await post({ message: "what can you do", context: { workspaces: ["Pets"], hasResults: true, selectionCount: 3 } });
    expect(mocks.parse).toHaveBeenCalledWith("what can you do", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), {
      workspaces: ["Pets"],
      hasResults: true,
      selectionCount: 3,
    });
  });

  it("treats a search as a search whatever target the parser paired it with", async () => {
    const { rpc } = arrange();
    mocks.parse.mockResolvedValue({ intent: { action: "search", target: "selection" }, parsed: PARSED });
    const json = await (await post({ message: "dogs" })).json();
    expect(json.intent.target).toBe("new_search");
    expect(rpc).toHaveBeenCalled();
  });

  it("falls back to a plain semantic search when the parser fails", async () => {
    const { rpc } = arrange();
    mocks.parse.mockRejectedValue(new Error("model down"));
    const response = await post({ message: "flooded streets" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.intent).toEqual({ action: "search", target: "new_search" });
    expect(json.parsed.semantic_text).toBe("flooded streets");
    expect(mocks.embed).toHaveBeenCalledWith("flooded streets");
    expect(rpc).toHaveBeenCalledWith("search_assets", expect.objectContaining({ text_query: "flooded streets", tag_terms: undefined }));
  });

  it("is 502 when the embedding is unavailable, and 500 when the RPC fails", async () => {
    arrange();
    mocks.parse.mockResolvedValue({ intent: { action: "search", target: "new_search" }, parsed: PARSED });
    mocks.embed.mockRejectedValue(new Error("quota"));
    expect((await post({ message: "dogs" })).status).toBe(502);

    const { rpc } = arrange();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await post({ message: "dogs" })).status).toBe(500);
  });

  it("refuses a signed-out caller, a caller with no workspace and a malformed body", async () => {
    arrange(null);
    expect((await post({ message: "dogs" })).status).toBe(401);

    arrange();
    mocks.workspaceId.mockResolvedValue(null);
    expect((await post({ message: "dogs" })).status).toBe(403);

    arrange();
    expect((await post({ message: "d" })).status).toBe(400);
    expect((await post({ message: "dogs", projectId: "nope" })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
