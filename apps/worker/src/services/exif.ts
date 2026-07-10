import exifr from "exifr";

/** EXIF extraction (spec §8.1) via exifr for everything sharp can open;
 *  RAW files usually still expose the standard TIFF/EXIF block to exifr. */

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

export async function extractExif(buf: Buffer): Promise<ParsedExif | null> {
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
