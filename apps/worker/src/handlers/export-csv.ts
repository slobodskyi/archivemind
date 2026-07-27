import {
  type ArtboardSettings,
  type CaptionLang,
  type CaptionRowLike,
  type CaptionStyleKey,
} from "@archivemind/shared";
import type pg from "pg";
import type { ExportRow } from "./export";

/** captions.csv export (TECH_SPEC §8.5, revived — see ADR 0035 Amendments).
 *
 *  One row per photo, in the same page order the PDF would use, carrying
 *  everything a downstream consumer needs: the generated captions in ALL THREE
 *  languages of the chosen style, the AI description, tags, facts split by
 *  review status, and the full EXIF the PDF only ever summarised. This is the
 *  handoff a PDF cannot do — an agency caption field, a CMS import, a
 *  translation review, a spreadsheet pass by an editor.
 *
 *  No zip library, no image decode, no font: one text artifact through the same
 *  putObject the PDF path uses. */

const LANGS: CaptionLang[] = ["en", "uk", "ru"];

/** RFC 4180 serialization. CRLF line endings and a UTF-8 BOM, both for Excel:
 *  without the BOM it decodes uk/ru captions as mojibake, and it is lenient
 *  about CRLF but other consumers are not. A field is quoted when it contains a
 *  quote, a comma or a newline; embedded quotes double. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (v: string): string =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Flatten a multi-line value into one cell. Newlines are legal inside a quoted
 *  CSV field, but a caption that wraps across rows in a spreadsheet is a worse
 *  default than one that reads as a paragraph. */
const oneLine = (v: string): string => v.replace(/\s*\n+\s*/g, " ").trim();

export const CSV_HEADER = [
  "page",
  "filename",
  "asset_id",
  "taken_at",
  "camera",
  "lens",
  "iso",
  "aperture",
  "shutter",
  "place",
  "latitude",
  "longitude",
  "tags",
  "caption_style",
  "caption_en",
  "caption_uk",
  "caption_ru",
  "ai_description",
  "facts_confirmed",
  "facts_unreviewed",
] as const;

interface ExifRow {
  asset_id: string;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  iso: number | null;
  aperture: string | null;
  shutter: string | null;
  taken_at: Date | string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  gps_label: string | null;
}

export async function renderCaptionsCsv(
  pool: pg.Pool,
  rows: ExportRow[],
  options: ArtboardSettings,
): Promise<Buffer> {
  const assetIds = rows.map((r) => r.asset_id);

  const captions = new Map<string, CaptionRowLike[]>();
  const capRes = await pool.query<{ asset_id: string; lang: string; style: string; text: string }>(
    `select asset_id, lang, style, text from captions where asset_id = any($1)`,
    [assetIds],
  );
  for (const c of capRes.rows) {
    const arr = captions.get(c.asset_id) ?? [];
    arr.push({ lang: c.lang as CaptionLang, style: c.style as CaptionStyleKey, text: c.text });
    captions.set(c.asset_id, arr);
  }

  const exif = new Map<string, ExifRow>();
  const exifRes = await pool.query<ExifRow>(
    `select asset_id, camera_make, camera_model, lens, iso, aperture, shutter,
            taken_at, gps_lat, gps_lon, gps_label
       from asset_exif where asset_id = any($1)`,
    [assetIds],
  );
  for (const e of exifRes.rows) exif.set(e.asset_id, e);

  // Tags the PDF never carried, though TECH_SPEC §8.5 asked for them.
  const tags = new Map<string, string[]>();
  const tagRes = await pool.query<{ asset_id: string; name: string }>(
    `select at.asset_id, t.name
       from asset_tags at join tags t on t.id = at.tag_id
      where at.asset_id = any($1)
      order by at.asset_id, t.name`,
    [assetIds],
  );
  for (const t of tagRes.rows) {
    const arr = tags.get(t.asset_id) ?? [];
    arr.push(t.name);
    tags.set(t.asset_id, arr);
  }

  // Facts SPLIT BY STATUS rather than filtered or merged: the CSV is where a
  // machine consumer can tell verified ground truth from model guesses, which is
  // exactly why they were taken out of the PDF (ADR 0035 Amendments).
  const confirmed = new Map<string, string[]>();
  const unreviewed = new Map<string, string[]>();
  const factRes = await pool.query<{ asset_id: string; text: string; status: string }>(
    `select asset_id, text, status from facts
      where asset_id = any($1)
      order by asset_id, created_at, id`,
    [assetIds],
  );
  for (const f of factRes.rows) {
    const bucket = f.status === "confirmed" ? confirmed : unreviewed;
    const arr = bucket.get(f.asset_id) ?? [];
    arr.push(f.text);
    bucket.set(f.asset_id, arr);
  }

  const descriptions = new Map<string, string>();
  const descRes = await pool.query<{ asset_id: string; content: string | null }>(
    `select asset_id, content from embeddings where asset_id = any($1) and kind = 'image'`,
    [assetIds],
  );
  for (const d of descRes.rows) if (d.content) descriptions.set(d.asset_id, d.content);

  const table: string[][] = [[...CSV_HEADER]];
  rows.forEach((row, i) => {
    const e = exif.get(row.asset_id);
    const caps = captions.get(row.asset_id) ?? [];
    table.push([
      String(i + 1),
      row.title ?? "",
      row.asset_id,
      e?.taken_at ? new Date(e.taken_at).toISOString() : "",
      [e?.camera_make, e?.camera_model].filter(Boolean).join(" ").trim(),
      e?.lens ?? "",
      e?.iso != null ? String(e.iso) : "",
      e?.aperture ?? "",
      e?.shutter ?? "",
      e?.gps_label ?? "",
      e?.gps_lat != null ? String(e.gps_lat) : "",
      e?.gps_lon != null ? String(e.gps_lon) : "",
      (tags.get(row.asset_id) ?? []).join("; "),
      options.captionStyle,
      // Every language of the chosen style — a CSV is a data handoff, so the
      // lang picker's single choice would be a needless loss here.
      //
      // EXACT lookup, deliberately NOT resolveCaptionText: its fallback chain
      // (exact → English-of-style → …) is right for a laid-out page, which needs
      // *some* text under the photo, and wrong for a column labelled caption_uk,
      // which would then contain English. An empty cell is the useful answer —
      // it is precisely the "these still need Ukrainian" list.
      ...LANGS.map((lang) => oneLine(caps.find((c) => c.lang === lang && c.style === options.captionStyle)?.text ?? "")),
      oneLine(descriptions.get(row.asset_id) ?? ""),
      (confirmed.get(row.asset_id) ?? []).map(oneLine).join("; "),
      (unreviewed.get(row.asset_id) ?? []).map(oneLine).join("; "),
    ]);
  });

  return Buffer.from(toCsv(table), "utf8");
}
