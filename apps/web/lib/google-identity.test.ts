import { describe, expect, it } from "vitest";
import { mapGsiError } from "./google-identity";

describe("mapGsiError", () => {
  it("maps every GIS outcome to a first-party code", () => {
    expect(mapGsiError("access_denied")).toBe("drive_access_denied");
    expect(mapGsiError("admin_policy_enforced")).toBe("drive_admin_blocked");
    expect(mapGsiError("popup_closed")).toBe("drive_popup_closed");
    expect(mapGsiError("popup_failed_to_open")).toBe("drive_popup_blocked");
  });

  it("collapses unknown GIS strings to the generic code — never forwarded raw", () => {
    expect(mapGsiError("some_new_google_error")).toBe("drive_connect_failed");
    expect(mapGsiError(undefined)).toBe("drive_connect_failed");
  });
});
