import { describe, expect, it } from "vitest";
import { safeNextUrl } from "./safe-redirect";

const BASE = "https://www.archivemind.media/auth/callback?code=abc";

describe("safeNextUrl", () => {
  it("keeps a same-origin path, including its query and hash", () => {
    expect(safeNextUrl("/projects/42?view=map#top", BASE).toString()).toBe(
      "https://www.archivemind.media/projects/42?view=map#top",
    );
  });

  it("falls back to the root when next is missing or empty", () => {
    for (const next of [null, undefined, ""]) {
      expect(safeNextUrl(next, BASE).toString()).toBe("https://www.archivemind.media/");
    }
  });

  it("rejects every off-site form of next", () => {
    const hostile = [
      // Host-extension vectors — these are what actually escaped the old
      // `origin + next` concatenation: "@" makes the real origin userinfo, and
      // a leading "." or "-" just extends the hostname into attacker DNS.
      "@evil.com", // -> https://www.archivemind.media@evil.com  (host: evil.com)
      "%09@evil.com",
      ".evil.com", // -> host: www.archivemind.media.evil.com
      "-x.evil.com",
      // Scheme/protocol-relative vectors — inert under concatenation, but
      // live against the `new URL(next, base)` form this module uses, so the
      // leading-slash checks below are load-bearing, not decorative.
      "https://evil.com",
      "http://evil.com/x",
      "//evil.com",
      "/\\evil.com", // backslash form browsers normalise to "//"
      "/\t/evil.com", // tab the URL parser would strip back into "//"
      "/\n/evil.com",
      "javascript:alert(1)",
      "evil.com", // bare host — would resolve relative to /auth/
    ];

    for (const next of hostile) {
      expect(safeNextUrl(next, BASE).origin).toBe("https://www.archivemind.media");
      expect(safeNextUrl(next, BASE).toString()).toBe("https://www.archivemind.media/");
    }
  });

  it("builds against the public base it is given, not the request host", () => {
    // Vercel's internal host would arrive via request.url; nextUrl carries this.
    expect(safeNextUrl("/projects", "https://www.archivemind.media/auth/callback").host).toBe(
      "www.archivemind.media",
    );
  });
});
