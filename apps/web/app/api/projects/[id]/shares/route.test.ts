import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sealShareToken: vi.fn(),
  openShareToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/integrations/project-shares.server", () => ({
  sealShareToken: mocks.sealShareToken,
  openShareToken: mocks.openShareToken,
}));
// vitest has no `@/` alias: the pure modules run for real.
vi.mock("@/lib/project-shares", async () => import("../../../../../lib/project-shares"));
vi.mock("@/lib/project-shares-server", async () => import("../../../../../lib/project-shares-server"));
vi.mock("@/lib/share-token", async () => import("../../../../../lib/share-token"));

import { GET, POST } from "./route";

const projectId = "22222222-2222-4222-8222-222222222222";
const shareId = "33333333-3333-4333-8333-333333333333";
const storedToken = "s".repeat(43);

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: shareId,
    label: null,
    can_download: true,
    can_upload: true,
    status: "live",
    created_at: "2026-11-03T10:00:00+00:00",
    expires_at: "2026-11-10T10:00:00+00:00",
    created_by: "44444444-4444-4444-8444-444444444444",
    created_by_name: "Oleksandr",
    token_ciphertext: "v1:iv:ct:tag",
    download_count: 0,
    last_opened_at: null,
    last_upload_at: null,
    files_received: 0,
    bytes_received: 0,
    max_files: 2000,
    max_bytes: 21474836480,
    ...overrides,
  };
}

function arrange(options: {
  user?: { id: string } | null;
  rows?: unknown[];
  listError?: { code?: string; message?: string };
  createError?: { code?: string; message?: string };
} = {}) {
  const single = vi.fn().mockResolvedValue(
    options.createError
      ? { data: null, error: options.createError }
      : { data: { id: shareId, created_at: "2026-11-03T10:00:00+00:00", expires_at: "2026-11-10T10:00:00+00:00" }, error: null },
  );
  const rpc = vi.fn((name: string) => {
    if (name === "create_project_share") return { single };
    return Promise.resolve(
      options.listError ? { data: null, error: options.listError } : { data: options.rows ?? [shareRow()], error: null },
    );
  });
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: "user-1" } : options.user },
      }),
    },
    rpc,
  });
  return { rpc };
}

const ctx = (id = projectId) => ({ params: Promise.resolve({ id }) });

function post(body: unknown) {
  return new Request(`http://localhost/api/projects/${projectId}/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.sealShareToken.mockReturnValue("v1:sealed");
  mocks.openShareToken.mockReturnValue(storedToken);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/projects/[id]/shares", () => {
  it("answers 404 for a malformed id without opening a session", async () => {
    const response = await GET(new Request("http://localhost"), ctx("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("answers 401 without a user", async () => {
    const { rpc } = arrange({ user: null });

    const response = await GET(new Request("http://localhost"), ctx());

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lists links with a path for live ones only, and never the ciphertext", async () => {
    const { rpc } = arrange({
      rows: [shareRow(), shareRow({ id: "55555555-5555-4555-8555-555555555555", status: "expired" })],
    });

    const response = await GET(new Request("http://localhost"), ctx());
    const text = await response.text();
    const body = JSON.parse(text) as { shares: { status: string; path: string | null }[] };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("list_project_shares", { p_project_id: projectId });
    expect(body.shares.map((share) => [share.status, share.path])).toEqual([
      ["live", `/s/${storedToken}`],
      ["expired", null],
    ]);
    expect(text).not.toContain("v1:iv:ct:tag");
  });

  it("maps a viewer's refusal to 403", async () => {
    arrange({ listError: { code: "42501", message: "project_share_editor_required" } });

    const response = await GET(new Request("http://localhost"), ctx());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "editor_required" });
  });
});

describe("POST /api/projects/[id]/shares", () => {
  it("refuses a body with rights the mode does not name", async () => {
    const { rpc } = arrange();

    const response = await POST(post({ mode: "download", expiresInDays: 7, canUpload: true }), ctx());

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores the digest and the sealed copy, and returns the token only in the path", async () => {
    const { rpc } = arrange();

    const response = await POST(post({ mode: "upload", expiresInDays: 30, label: " Agency " }), ctx());
    const body = (await response.json()) as { share: { path: string; mode: string } };

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const token = body.share.path.replace(/^\/s\//, "");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.share.mode).toBe("both");
    expect(rpc).toHaveBeenCalledWith("create_project_share", {
      p_project_id: projectId,
      p_can_download: false,
      p_can_upload: true,
      p_expires_in_days: 30,
      p_label: "Agency",
      p_token_hash: createHash("sha256").update(token).digest("hex"),
      p_token_ciphertext: "v1:sealed",
      p_scope: "project",
      p_board_id: null,
      p_asset_ids: null,
    });
    expect(mocks.sealShareToken).toHaveBeenCalledWith(token);
  });

  it("passes a Workspace link's board and a list's ids through to the RPC", async () => {
    const boardId = "66666666-6666-4666-8666-666666666666";
    const assetId = "77777777-7777-4777-8777-777777777777";
    const { rpc } = arrange();

    expect((await POST(post({ mode: "both", expiresInDays: 7, scope: "board", boardId }), ctx())).status).toBe(201);
    expect(rpc).toHaveBeenLastCalledWith("list_project_shares", { p_project_id: projectId });
    expect((rpc.mock.calls[0] as unknown as [string, object])[1]).toMatchObject({ p_scope: "board", p_board_id: boardId, p_asset_ids: null });

    rpc.mockClear();
    expect((await POST(post({ mode: "download", expiresInDays: 7, scope: "selection", assetIds: [assetId] }), ctx())).status).toBe(201);
    expect((rpc.mock.calls[0] as unknown as [string, object])[1]).toMatchObject({ p_scope: "selection", p_board_id: null, p_asset_ids: [assetId], p_can_upload: false });
  });

  it("refuses a list with upload rights before reaching the database", async () => {
    const { rpc } = arrange();

    const response = await POST(
      post({ mode: "both", expiresInDays: 7, scope: "selection", assetIds: ["77777777-7777-4777-8777-777777777777"] }),
      ctx(),
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_project_share_board", "board_unavailable"],
    ["project_share_selection_empty", "selection_empty"],
    ["invalid_project_share_selection", "invalid_selection"],
    ["invalid_project_share_rights", "invalid_rights"],
    ["invalid_project_share_scope", "invalid_scope"],
    ["invalid_project_share_details", "invalid_details"],
    ["something_else", "invalid_share"],
  ])("maps the RPC's %s to a 400 %s", async (message, code) => {
    arrange({ createError: { code: "22023", message } });

    const response = await POST(post({ mode: "download", expiresInDays: 7, scope: "board", boardId: "66666666-6666-4666-8666-666666666666" }), ctx());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: code });
  });

  it("returns the fresh path even when the stored copy cannot be opened", async () => {
    arrange();
    mocks.openShareToken.mockReturnValue(null);

    const response = await POST(post({ mode: "download", expiresInDays: 1 }), ctx());
    const body = (await response.json()) as { share: { path: string | null } };

    expect(response.status).toBe(201);
    expect(body.share.path).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);
  });

  it("maps the per-project cap to 409 and logs the code alone", async () => {
    const { rpc } = arrange({ createError: { code: "53400", message: "project_share_limit" } });

    const response = await POST(post({ mode: "download", expiresInDays: 7 }), ctx());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "share_limit" });
    const digest = (rpc.mock.calls[0] as unknown as [string, { p_token_hash: string }])[1].p_token_hash;
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(digest);
  });
});
