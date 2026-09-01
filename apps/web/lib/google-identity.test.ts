import { describe, expect, it } from "vitest";
import { isPickerBlockedUA, mapGsiError } from "./google-identity";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
// Chrome on iOS is WebKit underneath and fails identically — the CriOS token is
// exactly the string a naive "is this Safari" check would let through.
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.0.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/536.36";

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

describe("isPickerBlockedUA", () => {
  it("flags every iOS browser, not just Safari — they all run WebKit", () => {
    expect(isPickerBlockedUA(IPHONE, 5)).toBe(true);
    expect(isPickerBlockedUA(IPHONE_CHROME, 5)).toBe(true);
  });

  it("flags an iPad on iPadOS 13+, which reports the desktop macOS UA", () => {
    expect(isPickerBlockedUA(IPAD_DESKTOP_UA, 5)).toBe(true);
  });

  it("leaves a real Mac alone — same UA, no touch points", () => {
    expect(isPickerBlockedUA(IPAD_DESKTOP_UA, 0)).toBe(false);
    expect(isPickerBlockedUA(MAC_CHROME, 0)).toBe(false);
  });

  it("leaves Android alone — Chrome there still allows third-party cookies", () => {
    expect(isPickerBlockedUA(ANDROID_CHROME, 5)).toBe(false);
  });
});
