import { describe, expect, it } from "vitest";
import {
  MS_SCOPES,
  accountTypeFromDriveType,
  authorizeUrl,
  createPkcePair,
  createState,
  emailFromMe,
  hasFilesReadScope,
  mapAuthorizeError,
  mapTokenExchangeError,
  statesMatch,
} from "./microsoft-oauth";

describe("microsoft oauth helpers (ADR 0047)", () => {
  it("requests the C4 minimum and nothing broader", () => {
    expect([...MS_SCOPES]).toEqual(["offline_access", "User.Read", "Files.Read"]);
    // The `.All` variants read everything shared WITH the user, not just their
    // own drive — the whole reason C4 pins this list.
    expect(MS_SCOPES.join(" ")).not.toMatch(/\.All\b/);
  });

  it("recognises a granted Files.Read however Microsoft spells it", () => {
    expect(hasFilesReadScope("Files.Read")).toBe(true);
    expect(hasFilesReadScope("https://graph.microsoft.com/Files.Read")).toBe(true);
    expect(hasFilesReadScope("offline_access files.read User.Read")).toBe(true);
    // ReadWrite implies Read — we never ask for it, but a widened grant is
    // still usable and must not read as "scope missing".
    expect(hasFilesReadScope("https://graph.microsoft.com/Files.ReadWrite")).toBe(true);
    expect(hasFilesReadScope("offline_access User.Read")).toBe(false);
    expect(hasFilesReadScope(undefined)).toBe(false);
    // Not a substring match: a scope that merely CONTAINS the name is not it.
    expect(hasFilesReadScope("NotFiles.ReadSomething")).toBe(false);
  });

  it("maps failures to first-party codes and never carries Microsoft's text", () => {
    expect(mapTokenExchangeError(400, { error: "invalid_grant" })).toBe("onedrive_code_invalid");
    expect(mapTokenExchangeError(500, {})).toBe("onedrive_connect_failed");
    expect(mapAuthorizeError("access_denied")).toBe("onedrive_access_denied");
    expect(mapAuthorizeError("some_new_thing")).toBe("onedrive_connect_failed");
    expect(mapAuthorizeError(null)).toBeNull();
  });

  it("PKCE pairs are S256 and unique per call", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    // RFC 7636 allows 43..128 chars; base64url of 32 bytes is 43.
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.challenge).not.toBe(a.verifier);
  });

  it("state comparison is exact and tolerates absent values", () => {
    const s = createState();
    expect(statesMatch(s, s)).toBe(true);
    expect(statesMatch(s, `${s}x`)).toBe(false);
    expect(statesMatch(s, undefined)).toBe(false);
    expect(statesMatch(undefined, undefined)).toBe(false);
    // A forged empty state must never satisfy a missing cookie.
    expect(statesMatch("", "")).toBe(false);
  });

  it("builds an authorize URL with PKCE and a forced account chooser", () => {
    const url = new URL(
      authorizeUrl({
        tenant: "common",
        clientId: "client-123",
        redirectUri: "https://app.test/api/sources/onedrive/oauth/callback",
        state: "st",
        codeChallenge: "ch",
      }),
    );
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toBe(MS_SCOPES.join(" "));
    // Without this, a live Microsoft session silently reconnects whoever the
    // browser last was — the "row claims Y, holds X's token" failure.
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("reads the account kind off the drive itself", () => {
    expect(accountTypeFromDriveType("personal")).toBe("personal");
    expect(accountTypeFromDriveType("business")).toBe("business");
    // documentLibrary (SharePoint) and anything unrecognised are treated as
    // business — the conservative side, since that is the facet-poor one.
    expect(accountTypeFromDriveType("documentLibrary")).toBe("business");
    expect(accountTypeFromDriveType(undefined)).toBe("business");
  });

  it("falls back to userPrincipalName when mail is null (usual on personal)", () => {
    expect(emailFromMe({ mail: "a@corp.test", userPrincipalName: "b@corp.test" })).toBe("a@corp.test");
    expect(emailFromMe({ mail: null, userPrincipalName: "b@live.test" })).toBe("b@live.test");
    expect(emailFromMe({})).toBeNull();
  });
});
