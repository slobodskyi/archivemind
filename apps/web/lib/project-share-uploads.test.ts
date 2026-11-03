import { describe, expect, it } from "vitest";
import {
  shareSenderName,
  shareUploadFilename,
  shareUploadKeyName,
  shareUploadMime,
  shareUploadOutcome,
} from "./project-share-uploads";

/** The reserve RPC's own checks, restated: anything these helpers produce
 *  must pass them, or a whole batch of a stranger's files fails as invalid. */
const KEY_NAME = /^[A-Za-z0-9_.()+ -]{1,200}$/;
const filenameOk = (name: string) => Array.from(name).length >= 1 && Array.from(name).length <= 255 && !/[\p{Cc}/\\]/u.test(name);

describe("shareUploadFilename", () => {
  it("drops any path a browser or a crafted request puts in front of the name", () => {
    expect(shareUploadFilename("../../etc/passwd")).toBe("passwd");
    expect(shareUploadFilename("C:\\Users\\me\\IMG_0001.JPG")).toBe("IMG_0001.JPG");
  });

  it("strips control and bidi characters, so a name cannot read as another extension", () => {
    expect(shareUploadFilename("photo\u202egpj.exe")).toBe("photogpj.exe");
    expect(shareUploadFilename("a\u0000b\nc.jpg")).toBe("ab c.jpg");
    expect(shareUploadFilename("\u2066x\u2069.png")).toBe("x.png");
  });

  it("keeps Cyrillic and emoji (ZWJ included) as the owner will want to read them", () => {
    expect(shareUploadFilename("Фото з Одеси.heic")).toBe("Фото з Одеси.heic");
    expect(shareUploadFilename("👨‍👩‍👧.jpg")).toBe("👨‍👩‍👧.jpg");
  });

  it("caps the length at 200 code points and keeps the extension", () => {
    const name = shareUploadFilename(`${"я".repeat(400)}.jpeg`);
    expect(Array.from(name)).toHaveLength(200);
    expect(name.endsWith(".jpeg")).toBe(true);
  });

  it("never returns an empty or dots-only name", () => {
    for (const raw of ["", "   ", "..", "/", "\u202e"]) expect(shareUploadFilename(raw)).toBe("file");
  });

  it("always satisfies the table's check", () => {
    for (const raw of ["a/b\\c", "\t\u0085x", "x".repeat(600), "имя.jpg"]) expect(filenameOk(shareUploadFilename(raw))).toBe(true);
  });
});

describe("shareUploadKeyName", () => {
  it("always matches the reserve RPC's key regex", () => {
    for (const raw of ["Фото 1.HEIC", "a?b*c.jpg", "  .hidden", "...", "x".repeat(300), "👨‍👩‍👧.jpg"]) {
      expect(shareUploadKeyName(shareUploadFilename(raw))).toMatch(KEY_NAME);
    }
  });

  it("never starts with a dot, so it cannot read as . or .. in a key", () => {
    expect(shareUploadKeyName("..x")).toBe("x");
    expect(shareUploadKeyName(".")).toBe("file");
  });
});

describe("shareUploadMime", () => {
  it("keeps a plain type/subtype and lower-cases it", () => {
    expect(shareUploadMime("image/HEIC")).toBe("image/heic");
    expect(shareUploadMime("application/vnd.adobe.photoshop")).toBe("application/vnd.adobe.photoshop");
  });

  it("turns anything else into octet-stream", () => {
    for (const raw of ["", "text/html; charset=utf-8", "image/jpeg\r\nX-Evil: 1", "nonsense"]) {
      expect(shareUploadMime(raw)).toBe("application/octet-stream");
    }
  });
});

describe("shareSenderName", () => {
  it("is one clean line of at most 80 characters, or null", () => {
    expect(shareSenderName("  Olena\n\tK.  ")).toBe("Olena K.");
    expect(shareSenderName("\u202e")).toBeNull();
    expect(shareSenderName(null)).toBeNull();
    expect(Array.from(shareSenderName("ж".repeat(200)) ?? "")).toHaveLength(80);
  });
});

describe("shareUploadOutcome", () => {
  it("tells the sender received / rejected / pending and nothing finer", () => {
    expect(shareUploadOutcome("completed")).toBe("received");
    expect(shareUploadOutcome("rejected")).toBe("rejected");
    expect(shareUploadOutcome("expired")).toBe("pending");
    expect(shareUploadOutcome("finalizing")).toBe("pending");
    expect(shareUploadOutcome("reserved")).toBe("pending");
  });
});
