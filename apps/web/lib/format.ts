import type { CaptionStyle, FactStatus, Language, Photo, PhotoStatus } from "@/types";
import { CAPTIONS, STATUS_META } from "./mock-data";

/** Dot colors for fact verification states (source's exact hexes). */
export const FACT_STATUS_COLOR: Record<FactStatus, string> = {
  confirmed: "#22c55e",
  pending: "#f4b740",
  unknown: "#9aa0a6",
};

/** Resolve a photo's caption text for a language + style (source `capText`). */
export function getCaptionText(
  photo: Photo | null,
  lang: Language,
  style: CaptionStyle,
): string {
  if (!photo) return "";
  // Real generated captions win; the mock CAPTIONS path survives for mock rows.
  if (photo.captionTexts) return photo.captionTexts[`${lang}:${style}`] ?? "";
  if (!photo.captionKey) return "";
  const base = CAPTIONS[photo.captionKey][lang] || CAPTIONS[photo.captionKey].EN;
  if (style === "Social") {
    const first = base.split(". ")[0];
    return (
      first +
      (first.endsWith(".") ? "" : ".") +
      (lang === "EN" ? " #Kyiv #Ukraine2026 #photojournalism" : " #Kyiv")
    );
  }
  return base;
}

export function statusMeta(status: PhotoStatus): { color: string; label: string } {
  return STATUS_META[status] || STATUS_META["Needs check"];
}
