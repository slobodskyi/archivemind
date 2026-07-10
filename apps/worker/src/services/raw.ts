import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exiftool } from "exiftool-vendored";

/** RAW (NEF/CR2/ARW…) → embedded JPEG via the spec §8.1 cascade:
 *  extractJpgFromRaw → extractPreview → extractThumbnail. No full RAW decode
 *  in MVP. NEF/CR2 usually embed full-res; Sony ARW ~1616×1080 (fine for the
 *  grid). Returns null when nothing can be extracted — caller marks the asset
 *  kind='other' and skips AI (spec). */

export const RAW_EXTENSIONS = new Set(["nef", "cr2", "cr3", "arw", "raf", "orf", "rw2", "dng"]);

export function isRawFilename(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return RAW_EXTENSIONS.has(ext);
}

type Extractor = (src: string, dest: string) => Promise<unknown>;

/** Exposed for unit tests: runs extractors in order, returns the first
 *  non-empty output file. */
export async function extractWithCascade(
  buf: Buffer,
  filename: string,
  extractors: Extractor[],
): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "am-raw-"));
  const src = path.join(dir, filename.replace(/[^\w.\-]+/g, "_") || "input.raw");
  try {
    await writeFile(src, buf);
    for (const [i, extract] of extractors.entries()) {
      const dest = path.join(dir, `out-${i}.jpg`);
      try {
        await extract(src, dest);
        const out = await readFile(dest);
        if (out.length > 0) return out;
      } catch {
        // fall through to the next extractor
      }
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function rawToJpeg(buf: Buffer, filename: string): Promise<Buffer | null> {
  return extractWithCascade(buf, filename, [
    (s, d) => exiftool.extractJpgFromRaw(s, d),
    (s, d) => exiftool.extractPreview(s, d),
    (s, d) => exiftool.extractThumbnail(s, d),
  ]);
}

/** ExifTool keeps a warm child-process pool — must be ended on shutdown or
 *  the worker process never exits. */
export async function closeExifTool(): Promise<void> {
  await exiftool.end();
}
