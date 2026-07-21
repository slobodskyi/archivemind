import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import exifr from "exifr";
import { exiftool, type Tags } from "exiftool-vendored";

/** EXIF extraction (spec §8.1). exifr is the fast path and covers JPEG/PNG/
 *  TIFF, but it rejects real iPhone HEIC outright: `exifr.parse` throws
 *  "Unknown file format" on a 2 MB iPhone 17 capture whose metadata ExifTool
 *  reads as 317 tags, GPS included. Every iPhone photo therefore landed with
 *  no capture date (Timeline dated it by upload instead), no camera, and no
 *  coordinates — the Map view had nothing to plot.
 *
 *  So: try exifr, and fall back to ExifTool whenever exifr yields nothing we
 *  would store. ExifTool is already a dependency and already runs as a shared
 *  singleton for RAW previews (services/raw.ts), closed in index.ts. */

export interface ParsedExif {
  taken_at: Date | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  iso: number | null;
  aperture: string | null;
  shutter: string | null;
  focal_length: string | null;
  raw: Record<string, unknown>;
}

/** FNumber 2.8 → "f/2.8" */
export function formatAperture(fNumber: number | undefined): string | null {
  if (!fNumber || !Number.isFinite(fNumber) || fNumber <= 0) return null;
  return `f/${Number(fNumber.toFixed(1))}`;
}

/** ExposureTime 0.004 → "1/250"; 2.5 → "2.5s" */
export function formatShutter(exposureSeconds: number | undefined): string | null {
  if (!exposureSeconds || !Number.isFinite(exposureSeconds) || exposureSeconds <= 0) return null;
  if (exposureSeconds >= 1) return `${Number(exposureSeconds.toFixed(1))}s`;
  return `1/${Math.round(1 / exposureSeconds)}`;
}

/** FocalLength 35 → "35mm" */
export function formatFocalLength(mm: number | undefined): string | null {
  if (!mm || !Number.isFinite(mm) || mm <= 0) return null;
  return `${Number(mm.toFixed(0))}mm`;
}

/** "1/50" and "6.0 mm" — ExifTool hands back display strings where exifr hands
 *  back numbers, so both shapes have to normalise to the same stored value. */
export function parseExposure(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const fraction = value.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Number(fraction[1]) / denominator : undefined;
  }
  const plain = Number.parseFloat(value);
  return Number.isFinite(plain) ? plain : undefined;
}

export function parseMillimetres(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const mm = Number.parseFloat(value);
  return Number.isFinite(mm) ? mm : undefined;
}

/** ExifTool reports magnitude plus a hemisphere ref. Most builds already sign
 *  the value, but applying the ref to the magnitude is correct either way —
 *  and getting it wrong mirrors a photo onto the opposite hemisphere. */
export function signedCoordinate(value: unknown, ref: unknown, negative: string): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  const isNegative =
    typeof ref === "string" && ref.trim().toUpperCase().startsWith(negative) ? true : value < 0;
  return isNegative ? -magnitude : magnitude;
}

/** Did we get anything actually worth storing? Tag count is the wrong test —
 *  a screenshot yields seven PNG tags and none of them are metadata. */
function isUseful(exif: ParsedExif | null): exif is ParsedExif {
  return (
    exif != null &&
    (exif.taken_at != null || exif.camera_make != null || exif.gps_lat != null || exif.iso != null)
  );
}

async function viaExifr(buf: Buffer): Promise<ParsedExif | null> {
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = (await exifr.parse(buf, { gps: true })) ?? undefined;
  } catch {
    return null; // corrupt/absent EXIF must never fail ingest
  }
  if (!parsed) return null;

  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const takenAt = parsed.DateTimeOriginal ?? parsed.CreateDate ?? null;

  return {
    taken_at: takenAt instanceof Date && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
    camera_make: str(parsed.Make),
    camera_model: str(parsed.Model),
    lens: str(parsed.LensModel),
    gps_lat: num(parsed.latitude) ?? null,
    gps_lon: num(parsed.longitude) ?? null,
    iso: num(parsed.ISO) ?? null,
    aperture: formatAperture(num(parsed.FNumber)),
    shutter: formatShutter(num(parsed.ExposureTime)),
    focal_length: formatFocalLength(num(parsed.FocalLength)),
    raw: parsed as Record<string, unknown>,
  };
}

/** Exposed for unit tests: ExifTool's tag shape → our stored columns. */
export function fromExifToolTags(tags: Tags): ParsedExif {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  // ExifDateTime carries the original offset; toDate() resolves it correctly.
  const source = tags.DateTimeOriginal ?? tags.CreateDate;
  const taken =
    source && typeof source === "object" && "toDate" in source && typeof source.toDate === "function"
      ? source.toDate()
      : source instanceof Date
        ? source
        : null;

  return {
    taken_at: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken : null,
    camera_make: str(tags.Make),
    camera_model: str(tags.Model),
    lens: str(tags.LensModel),
    gps_lat: signedCoordinate(tags.GPSLatitude, tags.GPSLatitudeRef, "S"),
    gps_lon: signedCoordinate(tags.GPSLongitude, tags.GPSLongitudeRef, "W"),
    iso: num(tags.ISO) ?? null,
    aperture: formatAperture(num(tags.FNumber)),
    shutter: formatShutter(parseExposure(tags.ExposureTime)),
    focal_length: formatFocalLength(parseMillimetres(tags.FocalLength)),
    raw: tags as unknown as Record<string, unknown>,
  };
}

/** ExifTool reads paths, not buffers, so the bytes take a trip through a temp
 *  file. The extension matters — it is how ExifTool picks its parser. */
async function viaExifTool(buf: Buffer, filename: string): Promise<ParsedExif | null> {
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "bin").replace(/[^a-z0-9]/g, "");
  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), "am-exif-"));
    const file = path.join(dir, `input.${ext}`);
    await writeFile(file, buf);
    return fromExifToolTags(await exiftool.read(file));
  } catch (e) {
    // Metadata problems never fail ingest — but they must not be silent
    // either. ExifTool is a spawned Perl process, so "works on the dev's Mac,
    // dies in the container" is a real failure mode, and swallowing it makes
    // the whole fallback look like a file with no metadata.
    console.warn(`[exif] ExifTool fallback failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** One-shot probe so a broken ExifTool is visible at boot rather than as a
 *  archive-wide absence of metadata nobody can explain. */
export async function checkExifToolAvailable(): Promise<string | null> {
  try {
    const version = await exiftool.version();
    console.log(`[exif] ExifTool ${version} available`);
    return version;
  } catch (e) {
    console.error(
      `[exif] ExifTool UNAVAILABLE (${e instanceof Error ? e.message : String(e)}) — ` +
        `HEIC and RAW files will lose their metadata`,
    );
    return null;
  }
}

/** `filename` only steers ExifTool's format detection; it is never trusted for
 *  anything else. */
export async function extractExif(buf: Buffer, filename = ""): Promise<ParsedExif | null> {
  const fast = await viaExifr(buf);
  if (isUseful(fast)) return fast;
  // exifr came back empty — which for HEIC means it refused the file entirely.
  const thorough = await viaExifTool(buf, filename);
  if (isUseful(thorough)) {
    console.log(`[exif] ${filename || "file"}: exifr found nothing, ExifTool recovered it`);
    return thorough;
  }
  return fast ?? thorough;
}
