import { describe, expect, it } from "vitest";
import { driveErrorMessage } from "./drive-errors";

const GENERIC = "Couldn't connect Google Drive. Please try again.";

describe("driveErrorMessage", () => {
  it("returns authored copy for known codes", () => {
    expect(driveErrorMessage("drive_access_denied")).toBe("Connection cancelled.");
    expect(driveErrorMessage("drive_admin_blocked")).toMatch(/Workspace admin/);
    expect(driveErrorMessage("drive_scope_missing")).toMatch(/Drive permission/);
  });

  it("falls back to generic copy for unknown or absent codes", () => {
    expect(driveErrorMessage("drive_new_code_from_the_future")).toBe(GENERIC);
    expect(driveErrorMessage(undefined)).toBe(GENERIC);
    expect(driveErrorMessage(null)).toBe(GENERIC);
    expect(driveErrorMessage(42)).toBe(GENERIC);
  });

  it("never resolves prototype keys (the #91 regression, ADR 0021)", () => {
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(driveErrorMessage(code)).toBe(GENERIC);
    }
  });
});
