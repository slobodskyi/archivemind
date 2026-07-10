import { describe, expect, it } from "vitest";
import { decodeRoute } from "../handlers/ingest";
import { formatAperture, formatFocalLength, formatShutter } from "./exif";
import { extractWithCascade } from "./raw";

describe("decodeRoute", () => {
  it("routes by MIME with RAW detected from the filename", () => {
    expect(decodeRoute("image/jpeg", "a.jpg")).toBe("sharp");
    expect(decodeRoute("image/heic", "IMG_1.HEIC")).toBe("heic");
    expect(decodeRoute("application/octet-stream", "DSC_1.NEF")).toBe("raw");
    expect(decodeRoute("image/x-sony-arw", "shot.arw")).toBe("raw");
    expect(decodeRoute("application/pdf", "doc.pdf")).toBe("pdf");
    expect(decodeRoute("image/bmp", "x.bmp")).toBe("sharp"); // let sharp try
    expect(decodeRoute("video/mp4", "clip.mp4")).toBe("skip");
    expect(decodeRoute(null, "unknown.bin")).toBe("skip");
  });
});

describe("exif formatters", () => {
  it("formats aperture/shutter/focal length like a camera would", () => {
    expect(formatAperture(2.8)).toBe("f/2.8");
    expect(formatShutter(0.004)).toBe("1/250");
    expect(formatShutter(2.5)).toBe("2.5s");
    expect(formatFocalLength(35)).toBe("35mm");
  });

  it("returns null on junk", () => {
    expect(formatAperture(0)).toBeNull();
    expect(formatAperture(undefined)).toBeNull();
    expect(formatShutter(-1)).toBeNull();
    expect(formatFocalLength(Number.NaN)).toBeNull();
  });
});

describe("extractWithCascade", () => {
  const writeOut = (content: string) => async (_src: string, dest: string) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(dest, content);
  };
  const boom = async () => {
    throw new Error("extractor failed");
  };

  it("returns the first extractor's output when it succeeds", async () => {
    const out = await extractWithCascade(Buffer.from("raw"), "a.nef", [writeOut("full"), writeOut("preview")]);
    expect(out?.toString()).toBe("full");
  });

  it("falls through failing extractors in order (spec §8.1 cascade)", async () => {
    const out = await extractWithCascade(Buffer.from("raw"), "a.arw", [boom, boom, writeOut("thumb")]);
    expect(out?.toString()).toBe("thumb");
  });

  it("returns null when every extractor fails", async () => {
    const out = await extractWithCascade(Buffer.from("raw"), "a.cr2", [boom, boom, boom]);
    expect(out).toBeNull();
  });
});
