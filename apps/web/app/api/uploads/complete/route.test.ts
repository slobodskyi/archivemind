import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/workspace", () => ({
  getCurrentWorkspaceId: mocks.getCurrentWorkspaceId,
}));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const completionId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/uploads/complete", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    completionId,
    projectId,
    uploads: [
      {
        r2Key: `${workspaceId}/originals/object/photo.jpg`,
        filename: "photo.jpg",
        mime: "image/jpeg",
        size: 123,
      },
    ],
    ...overrides,
  };
}

function arrange(options: {
  user?: { id: string } | null;
  workspace?: string | null;
  data?: unknown;
  error?: { code?: string; message?: string } | null;
} = {}) {
  const single = vi.fn().mockResolvedValue({
    data: options.data ?? { asset_ids: [assetId], job_id: jobId },
    error: options.error ?? null,
  });
  const rpc = vi.fn(() => ({ single }));
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: "user-1" } : options.user },
      }),
    },
    rpc,
  };
  mocks.createClient.mockResolvedValue(supabase);
  mocks.getCurrentWorkspaceId.mockResolvedValue(
    options.workspace === undefined ? workspaceId : options.workspace,
  );
  return { rpc, single, supabase };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/uploads/complete", () => {
  it("returns 401 before resolving a workspace when there is no user", async () => {
    arrange({ user: null });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.getCurrentWorkspaceId).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no workspace", async () => {
    const { rpc } = arrange({ workspace: null });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "no workspace" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing completion UUID and a foreign R2 prefix", async () => {
    const { rpc } = arrange();

    const missingId = await POST(request(validBody({ completionId: undefined })));
    const foreignKey = await POST(
      request(
        validBody({
          uploads: [
            {
              r2Key: "another-workspace/originals/object/photo.jpg",
              filename: "photo.jpg",
              mime: "image/jpeg",
              size: 123,
            },
          ],
        }),
      ),
    );

    expect(missingId.status).toBe(400);
    expect(foreignKey.status).toBe(400);
    expect(await foreignKey.json()).toEqual({ error: "r2Key outside workspace" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes only server-resolved ids and normalized snake_case uploads to the RPC", async () => {
    const { rpc, single } = arrange();

    const response = await POST(
      request(validBody({ workspaceId: "attacker-controlled" }), {
        "x-archivemind-upload-batch": "trace-batch",
        "x-archivemind-upload-chunk": "1/1",
      }),
    );

    expect(rpc).toHaveBeenCalledWith("complete_upload_batch", {
      p_workspace_id: workspaceId,
      p_project_id: projectId,
      p_completion_id: completionId,
      p_uploads: [
        {
          r2_key: `${workspaceId}/originals/object/photo.jpg`,
          filename: "photo.jpg",
          mime: "image/jpeg",
          byte_size: 123,
        },
      ],
    });
    expect(single).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assetIds: [assetId], jobId });
  });

  it("passes a missing project as SQL null", async () => {
    const { rpc } = arrange();

    await POST(request(validBody({ projectId: undefined })));

    expect(rpc).toHaveBeenCalledWith(
      "complete_upload_batch",
      expect.objectContaining({ p_project_id: null }),
    );
  });

  it.each([
    ["23505", "upload_completion_conflict", 409, "upload completion conflict"],
    ["42501", "upload_editor_required", 403, "forbidden"],
    ["P0002", "upload_project_not_found", 404, "project not found"],
    ["22023", "invalid_upload_completion: secret detail", 400, "invalid upload completion"],
    ["XX000", "private database detail", 500, "upload completion failed"],
  ])("sanitizes RPC error %s", async (code, message, status, publicMessage) => {
    arrange({ error: { code, message } });

    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toEqual({ error: publicMessage });
    expect(JSON.stringify(body)).not.toContain(message);
  });

  it("does not return malformed or partial RPC data as success", async () => {
    arrange({ data: { asset_ids: [], job_id: jobId } });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "upload completion failed" });
  });
});
