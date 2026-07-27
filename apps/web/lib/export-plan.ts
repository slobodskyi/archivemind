import {
  resolveCaptionText,
  type ArtboardSettings,
  type CaptionLang,
  type CaptionRowLike,
  type CaptionStyleKey,
} from "@archivemind/shared";
import type { CaptionStyle, Language, Photo } from "@/types";

/** Pure answers the export dialog needs about a run, kept out of the component
 *  so they can be tested. Every one of them is a claim the dialog makes to the
 *  user about what the worker will produce — the class of statement that has
 *  been wrong repeatedly, so it is worth pinning. */

/** ArtboardSettings speaks the DB's lowercase enums; Photo.captions is keyed by
 *  the UI's cased unions. */
export const LANG_UI: Record<ArtboardSettings["captionLang"], Language> = { en: "EN", uk: "UK", ru: "RU" };
export const STYLE_UI: Record<ArtboardSettings["captionStyle"], CaptionStyle> = {
  social: "Social",
  agency: "Agency",
  archival: "Archival",
};
const LANG_DB: Record<Language, CaptionLang> = { EN: "en", UK: "uk", RU: "ru" };
const STYLE_DB: Record<CaptionStyle, CaptionStyleKey> = {
  Social: "social",
  Agency: "agency",
  Archival: "archival",
};

export type CaptionState = "exact" | "fallback" | "none";

/** Photo.captions flattened into the shape resolveCaptionText parses. */
export function captionRows(photo: Pick<Photo, "captions"> | undefined): CaptionRowLike[] {
  const out: CaptionRowLike[] = [];
  for (const [langUi, byStyle] of Object.entries(photo?.captions ?? {})) {
    for (const [styleUi, row] of Object.entries(byStyle ?? {})) {
      if (row?.text) {
        out.push({ lang: LANG_DB[langUi as Language], style: STYLE_DB[styleUi as CaptionStyle], text: row.text });
      }
    }
  }
  return out;
}

/** Will a caption reach this photo's page/row, and did it have to compromise?
 *
 *  PDF asks the worker's own `resolveCaptionText`, because "a caption exists"
 *  and "something will print" are different questions: the resolver returns ""
 *  when the request is `en` and only non-English captions exist.
 *
 *  CSV (and the CSV inside a ZIP) is a different contract entirely — export-csv
 *  does an EXACT style lookup with no fallback, deliberately, so the empty cell
 *  is the "still needs translating" signal. Language is not the question there
 *  because every language ships as its own column. */
export function captionStateFor(
  photo: Pick<Photo, "captions"> | undefined,
  opts: { isDoc: boolean; lang: ArtboardSettings["captionLang"]; style: ArtboardSettings["captionStyle"] },
): CaptionState {
  const rows = captionRows(photo);
  if (rows.length === 0) return "none";
  if (!opts.isDoc) return rows.some((r) => r.style === opts.style) ? "exact" : "none";
  if (rows.some((r) => r.lang === opts.lang && r.style === opts.style)) return "exact";
  return resolveCaptionText(rows, opts.lang, opts.style) ? "fallback" : "none";
}

/** What the subtitle promises is under each photo. `include.title` renders
 *  `assets.title`, which IS the filename — there is no rename anywhere in the
 *  product — so calling it "title" implies something the user can set. */
export function underLabel(include: ArtboardSettings["include"]): string {
  const on = [include.title && "filename", include.caption && "caption", include.exif && "EXIF"].filter(
    Boolean,
  ) as string[];
  return on.length === 0 ? "photos only" : `${on.join(" + ")} under each`;
}

/** Pages in the delivered PDF. The worker inserts a real cover page and numbers
 *  every page against the total, so a count that ignores it is off by one in the
 *  file the user opens. Grid deliberately returns null: `cols` is columns per
 *  ROW and rows-per-page varies with the include toggles, so any number the
 *  dialog produced would be a guess. */
export function pdfPageCount(photos: number, cover: boolean, layout: ArtboardSettings["pageLayout"]): number | null {
  if (layout === "grid") return null;
  return photos + (cover ? 1 : 0);
}
