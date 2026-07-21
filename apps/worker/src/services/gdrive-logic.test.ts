import { describe, expect, it } from "vitest";
import { backoffMs, classifyDriveStatus } from "./gdrive";
import { parseRefreshResponse } from "./tokens";

describe("classifyDriveStatus", () => {
  it("retries quota-flavored 403s, 429 and 5xx", () => {
    expect(classifyDriveStatus(403, '{"reason":"userRateLimitExceeded"}')).toBe("retry");
    expect(classifyDriveStatus(403, '{"reason":"rateLimitExceeded"}')).toBe("retry");
    expect(classifyDriveStatus(429, "")).toBe("retry");
    expect(classifyDriveStatus(500, "")).toBe("retry");
    expect(classifyDriveStatus(503, "")).toBe("retry");
  });

  it("maps 404 to not_found (missing grant / deleted file — the setAppId symptom)", () => {
    expect(classifyDriveStatus(404, "File not found")).toBe("not_found");
  });

  it("maps 401 to unauthorized (mid-batch token expiry → single re-mint)", () => {
    expect(classifyDriveStatus(401, "")).toBe("unauthorized");
  });

  it("treats permission-flavored 403s as fatal, not retryable", () => {
    expect(classifyDriveStatus(403, '{"reason":"insufficientFilePermissions"}')).toBe("fatal");
    expect(classifyDriveStatus(400, "")).toBe("fatal");
  });

  it("passes 2xx through", () => {
    expect(classifyDriveStatus(200, "")).toBe("ok");
  });
});

describe("backoffMs", () => {
  it("grows exponentially and truncates at 64s", () => {
    expect(backoffMs(0)).toBeGreaterThanOrEqual(1500);
    expect(backoffMs(0)).toBeLessThan(2000);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(12_000);
    expect(backoffMs(20)).toBe(64_000);
  });
});

describe("parseRefreshResponse", () => {
  it("accepts a token grant and defaults expiry to an hour", () => {
    const ok = parseRefreshResponse(200, { access_token: "ya29.x", expires_in: 3599 });
    expect(ok).toEqual({ ok: true, accessToken: "ya29.x", expiresInS: 3599 });
    const noExp = parseRefreshResponse(200, { access_token: "ya29.x" });
    expect(noExp.ok && noExp.expiresInS).toBe(3600);
  });

  it("maps invalid_grant to the first-party revoked code (ADR 0021)", () => {
    expect(parseRefreshResponse(400, { error: "invalid_grant" })).toEqual({
      ok: false,
      code: "drive_connection_revoked",
    });
  });

  it("collapses everything else to a generic refresh failure", () => {
    expect(parseRefreshResponse(400, { error: "invalid_client" })).toEqual({
      ok: false,
      code: "drive_token_refresh_failed",
    });
    expect(parseRefreshResponse(500, {})).toEqual({
      ok: false,
      code: "drive_token_refresh_failed",
    });
    // 200 with no token is still a failure, never an ok with undefined
    expect(parseRefreshResponse(200, {}).ok).toBe(false);
  });
});
