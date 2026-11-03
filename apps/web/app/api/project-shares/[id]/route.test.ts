import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/integrations/project-shares.server", () => ({ openShareToken: vi.fn(), sealShareToken: vi.fn() }));
// vitest has no `@/` alias: the pure modules run for real.
vi.mock("@/lib/project-shares", async () => import("../../../../lib/project-shares"));
vi.mock("@/lib/project-shares-server", async () => import("../../../../lib/project-shares-server"));

import { DELETE, PATCH } from "./route";

const shareId = "33333333-3333-4333-8333-333333333333";

function arrange(options: {
  user?: { id: string } | null;
  errors?: Record<string, { code?: string; message?: string }>;
} = {}) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve({ data: name === "extend_project_share" ? "2026-12-03T10:00:00+00:00" : null, error: options.errors?.[name] ?? null }),
  );
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

const ctx = (id = shareId) => ({ params: Promise.resolve({ id }) });

function patch(body: unknown) {
  return new Request(`http://localhost/api/project-shares/${shareId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/project-shares/[id]", () => {
  it("answers 404 for a malformed id and 401 without a user", async () => {
    expect((await PATCH(patch({ expiresInDays: 7 }), ctx("nope"))).status).toBe(404);
    const { rpc } = arrange({ user: null });
    expect((await PATCH(patch({ expiresInDays: 7 }), ctx())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty change and an expiry outside the four", async () => {
    const { rpc } = arrange();
    expect((await PATCH(patch({}), ctx())).status).toBe(400);
    expect((await PATCH(patch({ expiresInDays: 365 }), ctx())).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("extends and relabels through their own RPCs", async () => {
    const { rpc } = arrange();

    const response = await PATCH(patch({ expiresInDays: 90, label: "Agency" }), ctx());

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("extend_project_share", { p_share_id: shareId, p_expires_in_days: 90 });
    expect(rpc).toHaveBeenCalledWith("rename_project_share", { p_share_id: shareId, p_label: "Agency" });
  });

  it("says who may extend when the caller may not", async () => {
    arrange({ errors: { extend_project_share: { code: "42501", message: "project_share_owner_required" } } });

    const response = await PATCH(patch({ expiresInDays: 7 }), ctx());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "owner_required" });
  });

  it("reports a link that was already turned off", async () => {
    arrange({ errors: { extend_project_share: { code: "22023", message: "project_share_revoked" } } });

    const response = await PATCH(patch({ expiresInDays: 7 }), ctx());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "share_revoked" });
  });
});

describe("DELETE /api/project-shares/[id]", () => {
  it("turns the link off", async () => {
    const { rpc } = arrange();

    const response = await DELETE(new Request("http://localhost"), ctx());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(rpc).toHaveBeenCalledWith("revoke_project_share", { p_share_id: shareId });
  });

  it("maps a viewer's refusal to 403", async () => {
    arrange({ errors: { revoke_project_share: { code: "42501", message: "project_share_editor_required" } } });

    const response = await DELETE(new Request("http://localhost"), ctx());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "editor_required" });
  });
});
