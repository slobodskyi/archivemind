import { describe, expect, it } from "vitest";
import { isPublicPath } from "./proxy";

describe("isPublicPath — share links", () => {
  it("opens a project share link to somebody without an account (ADR 0051)", () => {
    const token = "t".repeat(43);
    expect(isPublicPath(`/s/${token}`)).toBe(true);
    expect(isPublicPath(`/s/${token}/media/4/original`)).toBe(true);
    expect(isPublicPath(`/s/${token}/downloads`)).toBe(true);
  });

  it("matches the /s segment, never a route that merely starts with an s", () => {
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/search")).toBe(false);
    expect(isPublicPath("/shares")).toBe(false);
    expect(isPublicPath("/projects/1")).toBe(false);
  });
});
