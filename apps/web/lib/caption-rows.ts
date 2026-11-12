import type { PhotoCaptions } from "../types";

/** A `captions` row as the database returns it. `lang` is the STORED enum, so it
 *  still includes "ru": rows written before Russian was retired exist and are
 *  never deleted. */
export interface CaptionDbRow {
  id: string;
  lang: "en" | "uk" | "ru";
  style: "social" | "agency" | "archival";
  text: string;
  is_edited: boolean;
}

/** DB caption enums → the mockup's UI labels. Russian is deliberately absent:
 *  it is no longer offered, so a stored "ru" row is skipped, not displayed. */
const CAPTION_LANG_UP: Partial<Record<CaptionDbRow["lang"], "EN" | "UK">> = { en: "EN", uk: "UK" };
const CAPTION_STYLE_UP = { social: "Social", agency: "Agency", archival: "Archival" } as const;

export function toCaptions(rows: CaptionDbRow[]): PhotoCaptions {
  const captions: PhotoCaptions = {};
  for (const c of rows) {
    const lang = CAPTION_LANG_UP[c.lang];
    const style = CAPTION_STYLE_UP[c.style];
    if (!lang || !style) continue; // retired "ru", or an unknown enum value from a future migration
    (captions[lang] ??= {})[style] = { id: c.id, text: c.text, edited: c.is_edited };
  }
  return captions;
}
