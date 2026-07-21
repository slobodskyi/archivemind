import { describe, expect, it } from "vitest";
import { DRIVE_SCOPE, emailFromIdToken, hasDriveScope, mapTokenExchangeError } from "./google-oauth";

describe("mapTokenExchangeError", () => {
  it("maps a spent/expired code to drive_code_invalid", () => {
    expect(mapTokenExchangeError(400, { error: "invalid_grant" })).toBe("drive_code_invalid");
  });

  it("collapses everything else to the generic first-party code (ADR 0021)", () => {
    expect(mapTokenExchangeError(400, { error: "invalid_client" })).toBe("drive_connect_failed");
    expect(mapTokenExchangeError(500, {})).toBe("drive_connect_failed");
    expect(mapTokenExchangeError(200, { error: undefined })).toBe("drive_connect_failed");
  });
});

describe("emailFromIdToken", () => {
  const jwt = (payload: object) =>
    ["eyJhbGciOiJSUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(
      ".",
    );

  it("extracts the email claim", () => {
    expect(emailFromIdToken(jwt({ email: "test@example.com", sub: "1" }))).toBe("test@example.com");
  });

  it("returns null for missing/non-string email, garbage, and non-strings", () => {
    expect(emailFromIdToken(jwt({ sub: "1" }))).toBeNull();
    expect(emailFromIdToken(jwt({ email: 42 }))).toBeNull();
    expect(emailFromIdToken("not-a-jwt")).toBeNull();
    expect(emailFromIdToken("a.!!!not-base64!!!.b")).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(emailFromIdToken(null)).toBeNull();
  });
});

describe("hasDriveScope", () => {
  it("finds drive.file in the space-separated scope list (real spike shape)", () => {
    expect(
      hasDriveScope(
        `openid ${DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email`,
      ),
    ).toBe(true);
  });

  it("rejects granular-consent responses where Drive was unticked", () => {
    expect(hasDriveScope("openid https://www.googleapis.com/auth/userinfo.email")).toBe(false);
    // prefix of the real scope must not match
    expect(hasDriveScope("https://www.googleapis.com/auth/drive")).toBe(false);
    expect(hasDriveScope(undefined)).toBe(false);
    expect(hasDriveScope("")).toBe(false);
  });
});
