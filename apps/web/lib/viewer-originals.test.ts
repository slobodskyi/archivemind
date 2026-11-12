import { describe, expect, it } from "vitest";
import { browserDecodes, formatBytes, originalMime, planOriginal, type OriginalAnswer } from "./viewer-originals";

const key = (name: string) => `ws/originals/11111111-1111-4111-8111-111111111111/${name}`;

describe("originalMime", () => {
  it("keeps a declared displayable type and normalises the jpeg aliases", () => {
    expect(originalMime("image/jpeg", key("a.jpg"))).toBe("image/jpeg");
    expect(originalMime("IMAGE/JPG", key("a"))).toBe("image/jpeg");
    expect(originalMime("image/pjpeg; charset=binary", key("a"))).toBe("image/jpeg");
    expect(originalMime("image/heic", key("IMG_0001.HEIC"))).toBe("image/heic");
  });

  it("refuses a declared type no browser draws, whatever the name says", () => {
    expect(originalMime("image/tiff", key("scan.jpg"))).toBeNull();
    expect(originalMime("image/x-nikon-nef", key("DSC_1.NEF"))).toBeNull();
    expect(originalMime("application/pdf", key("doc.pdf"))).toBeNull();
    expect(originalMime("image/svg+xml", key("logo.svg"))).toBeNull();
  });

  it("falls back to the key's extension when nothing specific was declared", () => {
    expect(originalMime(null, key("photo.JPEG"))).toBe("image/jpeg");
    expect(originalMime("application/octet-stream", key("photo.png"))).toBe("image/png");
    expect(originalMime("", key("IMG.heif"))).toBe("image/heif");
    expect(originalMime("", key("DSC_1.dng"))).toBeNull();
    expect(originalMime("", key("noextension"))).toBeNull();
    expect(originalMime("", "ws/originals.d/x/.jpg")).toBeNull();
  });
});

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";

describe("browserDecodes", () => {
  it("draws the common web formats everywhere", () => {
    for (const ua of [SAFARI_MAC, CHROME_MAC, FIREFOX]) {
      expect(browserDecodes("image/jpeg", ua)).toBe(true);
      expect(browserDecodes("image/avif", ua)).toBe(true);
    }
  });

  it("draws HEIC only in WebKit — Safari, and anything on iOS", () => {
    expect(browserDecodes("image/heic", SAFARI_MAC)).toBe(true);
    expect(browserDecodes("image/heic", CHROME_IOS)).toBe(true);
    expect(browserDecodes("image/heic", CHROME_MAC)).toBe(false);
    expect(browserDecodes("image/heif", FIREFOX)).toBe(false);
  });

  it("never claims a format outside the list", () => {
    expect(browserDecodes("image/tiff", SAFARI_MAC)).toBe(false);
  });
});

describe("planOriginal", () => {
  const ok: OriginalAnswer = { url: "https://r2/o.jpg", mime: "image/jpeg", bytes: 8_000_000 };
  const yes = () => true;

  it("loads a decodable original within the automatic cap", () => {
    expect(planOriginal(ok, { canDecode: yes, explicit: false })).toEqual({ kind: "load", url: ok.url });
  });

  it("asks before pulling a big or unmeasured original unasked", () => {
    const big = { ...ok, bytes: 62 * 1024 * 1024 };
    expect(planOriginal(big, { canDecode: yes, explicit: false })).toEqual({ kind: "ask", url: ok.url, bytes: big.bytes });
    expect(planOriginal({ ...ok, bytes: null }, { canDecode: yes, explicit: false }).kind).toBe("ask");
    expect(planOriginal(big, { canDecode: yes, explicit: true }).kind).toBe("load");
  });

  it("says why there is none", () => {
    expect(planOriginal({ url: null, reason: "not_stored" }, { canDecode: yes, explicit: true })).toEqual({ kind: "none", why: "not_stored" });
    expect(planOriginal({ url: null, reason: "format" }, { canDecode: yes, explicit: true })).toEqual({ kind: "none", why: "format" });
    expect(planOriginal({ ...ok, mime: "image/heic" }, { canDecode: () => false, explicit: true })).toEqual({ kind: "none", why: "browser" });
  });
});

describe("formatBytes", () => {
  it("prints whole megabytes, or kilobytes under one", () => {
    expect(formatBytes(62 * 1024 * 1024)).toBe("62 MB");
    expect(formatBytes(300 * 1024)).toBe("300 KB");
    expect(formatBytes(null)).toBe("");
  });
});
