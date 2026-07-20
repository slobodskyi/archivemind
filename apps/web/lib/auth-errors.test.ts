import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

const GENERIC = "Sign-in failed. Please try again.";

describe("authErrorMessage", () => {
  it("returns null only when no callback failure happened", () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage(undefined)).toBeNull();
  });

  it("treats a present-but-empty code as a failure, not as absence", () => {
    // The callback sets the param unconditionally, so "" means "we failed and
    // the provider told us nothing" — never "nothing went wrong".
    expect(authErrorMessage("")).toBe(GENERIC);
  });

  it("maps the codes we wrote copy for", () => {
    expect(authErrorMessage("otp_expired")).toBe(
      "That sign-in link has expired. Request a new one and try again.",
    );
    expect(authErrorMessage("provider_disabled")).toBe(
      "This sign-in method is currently unavailable.",
    );
    expect(authErrorMessage("access_denied")).toBe("Sign-in was cancelled.");
  });

  it("covers both spellings of the missing-PKCE-verifier failure", () => {
    // auth-js throws pkce_code_verifier_not_found; bad_code_verifier is the
    // GoTrue-side name. Same user-visible cause, so same copy.
    const expected =
      "This sign-in link was opened in a different browser. Open it where you started, or sign in again.";
    expect(authErrorMessage("pkce_code_verifier_not_found")).toBe(expected);
    expect(authErrorMessage("bad_code_verifier")).toBe(expected);
  });

  it("falls back to the generic sentence for codes we have no copy for", () => {
    expect(authErrorMessage("some_code_supabase_adds_in_2027")).toBe(GENERIC);
  });

  it("never resolves an inherited Object key to a non-string", () => {
    // `code` comes off the query string, so a plain object literal would let
    // /login?auth_error=constructor return `Object` itself — which then crosses
    // the server/client boundary as a function and breaks the page.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(authErrorMessage(key)).toBe(GENERIC);
    }
  });

  it("never returns provider-authored text", () => {
    // Descriptions are attacker-controllable on a URL anyone can send a victim;
    // only our own copy is ever displayed.
    expect(authErrorMessage("Your account is locked, call 555-0100")).toBe(GENERIC);
  });
});
