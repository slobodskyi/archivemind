import type { CaptionRow, CaptionStyle, ExifData, FactStatus, Language, Photo, PhotoStatus } from "@/types";
import { STATUS_META } from "./mock-data";

/** Dot colors for fact verification states (source's exact hexes). */
export const FACT_STATUS_COLOR: Record<FactStatus, string> = {
  confirmed: "#22c55e",
  pending: "#f4b740",
  unknown: "#9aa0a6",
};

/** UI labels → the DB caption enums (`caption_lang` / `caption_style`). */
export const CAPTION_LANG_DB: Record<Language, "en" | "uk" | "ru"> = { EN: "en", UK: "uk", RU: "ru" };
export const CAPTION_STYLE_DB: Record<CaptionStyle, "social" | "agency" | "archival"> = {
  Social: "social",
  Agency: "agency",
  Archival: "archival",
};

/** The real caption row for a language + style, if the worker generated one.
 *  (The mock CAPTIONS map is retired — #14; mock rows carry no captions.) */
export function getCaptionRow(photo: Photo | null, lang: Language, style: CaptionStyle): CaptionRow | null {
  return photo?.captions?.[lang]?.[style] ?? null;
}

/** Caption text for the drawer; falls back to EN so switching styles on a
 *  partially-captioned photo shows something rather than nothing. */
export function getCaptionText(photo: Photo | null, lang: Language, style: CaptionStyle): string {
  const row = getCaptionRow(photo, lang, style) ?? getCaptionRow(photo, "EN", style);
  return row?.text ?? "";
}

export function statusMeta(status: PhotoStatus): { color: string; label: string } {
  return STATUS_META[status] || STATUS_META["Needs check"];
}

/** Drawer GPS row: "50.4501, 30.5234 · Kyiv, Ukraine", degrading to the raw
 *  coordinates while the reverse-geocoded label is still missing, and to an
 *  em dash for the many files that carry no GPS at all. */
export function formatGps(exif: Pick<ExifData, "gpsLat" | "gpsLon" | "gpsLabel">): string {
  const { gpsLat, gpsLon, gpsLabel } = exif;
  const coords =
    gpsLat != null && gpsLon != null ? `${gpsLat.toFixed(4)}, ${gpsLon.toFixed(4)}` : null;
  const label = gpsLabel.trim() || null;
  if (coords && label) return `${coords} · ${label}`;
  return coords ?? label ?? "—";
}
