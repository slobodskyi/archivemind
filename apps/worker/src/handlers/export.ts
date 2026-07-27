import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import {
  EXPORT_PRESIGN_TTL_SECONDS,
  artboardSettingsSchema,
  exportJobPayloadSchema,
  resolveCaptionText,
  type ArtboardSettings,
  type CaptionLang,
  type CaptionRowLike,
  type CaptionStyleKey,
} from "@archivemind/shared";
import { getObjectBuffer, presignGetLong, putObject } from "../services/r2";
import { loadPdfFont } from "../services/pdf-font";
import type { HandlerContext } from "./index";

/** Artboard → PDF export (ADR 0035). Reads a group's ordered members (or an
 *  ad-hoc selection), renders each photo with its caption underneath into a PDF,
 *  stores it in R2 under {workspace_id}/exports/{job_id}.pdf, and writes a 7-day
 *  presigned URL back into ai_jobs.payload.result_url (the client polls
 *  GET /api/exports?jobId= once Realtime reports 'done').
 *
 *  Source images are the MEDIUM previews (edited-medium when an edit exists) —
 *  R2 already holds them for every source, and 1024px is ample for a page. The
 *  embedded font (services/pdf-font) covers Cyrillic so uk/ru captions render. */

interface ExportRow {
  asset_id: string;
  title: string | null;
  medium_key: string | null;
}

const PAGE_SIZES: Record<ArtboardSettings["pageSize"], { w: number; h: number }> = {
  A4: { w: 595.28, h: 841.89 },
  Letter: { w: 612, h: 792 },
};
const MARGIN = 42;
const TITLE_SIZE = 11;
const CAPTION_SIZE = 10;
const META_SIZE = 8;
const LINE_GAP = 1.35;
/** Gap between the photo and the text block below it. */
const IMG_TEXT_GAP = 16;
/** The photo never yields the whole page to text — see planPhotoPage. */
export const MIN_IMG_H = 120;
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.42, 0.42, 0.42);
const PLACEHOLDER = rgb(0.9, 0.9, 0.9);

/** Width of `text` at `size`, in PDF points. Injected so the page geometry below
 *  is a pure function testable without a real embedded font. */
export type Measure = (text: string, size: number) => number;

export function wrap(text: string, measure: Measure, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const word of words) {
      // A single token wider than the column (a URL, a long hashtag, CJK with no
      // spaces) must be hard-broken — otherwise it draws past the margin.
      for (const w of splitToWidth(word, measure, size, maxW)) {
        const trial = cur ? `${cur} ${w}` : w;
        if (cur && measure(trial, size) > maxW) {
          out.push(cur);
          cur = w;
        } else {
          cur = trial;
        }
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Chop one over-wide token into column-width pieces. Returns [token] untouched
 *  in the overwhelmingly common case that it already fits. */
function splitToWidth(token: string, measure: Measure, size: number, maxW: number): string[] {
  if (measure(token, size) <= maxW) return [token];
  const pieces: string[] = [];
  let cur = "";
  for (const ch of token) {
    if (cur && measure(cur + ch, size) > maxW) {
      pieces.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

const blockH = (lines: number, size: number, pad: number): number =>
  lines ? lines * size * LINE_GAP + pad : 0;

/** Cut wrapped text down to `max` lines, marking the cut with an ellipsis so a
 *  truncated caption never reads as a finished sentence. */
export function clampLines(lines: string[], max: number): { lines: string[]; truncated: boolean } {
  if (lines.length <= max) return { lines, truncated: false };
  const kept = lines.slice(0, Math.max(0, max));
  if (kept.length > 0) kept[kept.length - 1] = `${kept[kept.length - 1]}…`;
  return { lines: kept, truncated: true };
}

/** Fit one line to `maxW`, ellipsizing the tail. For the grid's single-line
 *  title and meta rows, where wrapping onto a second line would break the cell. */
export function truncateToWidth(text: string, measure: Measure, size: number, maxW: number): string {
  if (!text || measure(text, size) <= maxW) return text;
  let out = "";
  for (const ch of text) {
    if (measure(`${out}${ch}…`, size) > maxW) break;
    out += ch;
  }
  return out ? `${out}…` : "";
}

export interface PagePlan {
  titleLines: string[];
  capLines: string[];
  metaLines: string[];
  /** Height of the whole text block, including its inter-block padding. */
  textH: number;
  /** Height available to the photo — always ≥ MIN_IMG_H. */
  imgAreaH: number;
  /** True when the caption had to be cut to keep the photo on the page. */
  captionTruncated: boolean;
}

/** Lay out one photo page: wrap the text, then split the page between photo and
 *  text. The text block is bounded so the photo can never be squeezed below
 *  MIN_IMG_H — an unbounded caption used to drive the remaining height negative,
 *  which pdf-lib accepts without complaint and draws point-reflected off the top
 *  of the page. Caption lines that do not fit are dropped with an ellipsis; the
 *  caption is the only unbounded input (title is one field, meta is one line). */
export function planPhotoPage(
  pageW: number,
  pageH: number,
  text: { title: string; caption: string; meta: string },
  measure: Measure,
): PagePlan {
  const contentW = pageW - MARGIN * 2;
  const titleLines = text.title ? wrap(text.title, measure, TITLE_SIZE, contentW) : [];
  const wrappedCap = text.caption ? wrap(text.caption, measure, CAPTION_SIZE, contentW) : [];
  const metaLines = text.meta ? wrap(text.meta, measure, META_SIZE, contentW) : [];

  const fixedH = blockH(titleLines.length, TITLE_SIZE, 6) + blockH(metaLines.length, META_SIZE, 4);
  const budget = pageH - MARGIN * 2 - MIN_IMG_H - IMG_TEXT_GAP - fixedH;
  const capLineH = CAPTION_SIZE * LINE_GAP;
  const { lines: capLines, truncated: captionTruncated } = clampLines(
    wrappedCap,
    Math.max(0, Math.floor((budget - 4) / capLineH)),
  );

  const textH = fixedH + blockH(capLines.length, CAPTION_SIZE, 4);
  const imgAreaH = pageH - MARGIN * 2 - textH - IMG_TEXT_GAP;
  return { titleLines, capLines, metaLines, textH, imgAreaH, captionTruncated };
}

/** Fit `img` inside w×h, preserving aspect. Never returns a negative scale. */
export function fitScale(imgW: number, imgH: number, boxW: number, boxH: number): number {
  if (imgW <= 0 || imgH <= 0) return 0;
  return Math.max(0, Math.min(boxW / imgW, boxH / imgH));
}

/** Draw wrapped lines top-down from `y`, returning the y below the block. */
function drawLines(
  page: PDFPage,
  lines: string[],
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
): number {
  let cursor = y;
  const lh = size * LINE_GAP;
  for (const line of lines) {
    cursor -= lh;
    page.drawText(line, { x, y: cursor, size, font, color });
  }
  return cursor;
}

/** Decode a medium preview (webp) to a JPEG pdf-lib can embed. Null → no image. */
async function embedMedium(doc: PDFDocument, key: string | null): Promise<PDFImage | null> {
  if (!key) return null;
  try {
    const webp = await getObjectBuffer(key);
    const jpg = await sharp(webp).flatten({ background: "#ffffff" }).jpeg({ quality: 86 }).toBuffer();
    return await doc.embedJpg(jpg);
  } catch {
    return null; // a single unreadable preview must not fail the whole export
  }
}

export async function exportHandler({ pool, job, progress }: HandlerContext): Promise<void> {
  const payload = exportJobPayloadSchema.parse(job.payload);
  const options = artboardSettingsSchema.parse(payload.options);
  await progress(4, "Preparing export", 0, 1);

  // 1. Ordered asset list (group members by position, or the selection's order).
  let rows: ExportRow[];
  if (payload.group_id) {
    const r = await pool.query<ExportRow>(
      `select cga.asset_id, a.title,
              coalesce(ae.edited_medium_key, ap.r2_key) as medium_key
         from canvas_group_assets cga
         join assets a on a.id = cga.asset_id and a.status = 'active'
         left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
         left join asset_edits ae on ae.asset_id = a.id
        where cga.group_id = $1
        order by cga.position asc, cga.added_at asc`,
      [payload.group_id],
    );
    rows = r.rows;
  } else {
    const ids = payload.asset_ids ?? [];
    const r = await pool.query<ExportRow>(
      `select a.id as asset_id, a.title,
              coalesce(ae.edited_medium_key, ap.r2_key) as medium_key
         from assets a
         left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
         left join asset_edits ae on ae.asset_id = a.id
        where a.id = any($1) and a.status = 'active'`,
      [ids],
    );
    const byId = new Map(r.rows.map((row) => [row.asset_id, row]));
    rows = ids.map((id) => byId.get(id)).filter((x): x is ExportRow => Boolean(x));
  }
  if (rows.length === 0) throw new Error("export_empty");

  const assetIds = rows.map((r) => r.asset_id);
  const total = rows.length;

  // 2. Caption / facts / exif in batch, keyed by asset.
  const capByAsset = new Map<string, CaptionRowLike[]>();
  if (options.include.caption) {
    const capRes = await pool.query<{ asset_id: string; lang: string; style: string; text: string }>(
      `select asset_id, lang, style, text from captions where asset_id = any($1)`,
      [assetIds],
    );
    for (const c of capRes.rows) {
      const arr = capByAsset.get(c.asset_id) ?? [];
      arr.push({ lang: c.lang as CaptionLang, style: c.style as CaptionStyleKey, text: c.text });
      capByAsset.set(c.asset_id, arr);
    }
  }
  // Facts are deliberately NOT rendered: `analyze` only ever writes 'likely' or
  // 'needs_check', so an unreviewed asset's facts are model guesses by
  // construction, and a PDF that leaves the building must not print them in the
  // same register as facts the user confirmed. They belong in the captions CSV,
  // where they can carry their status column. See ADR 0035 Amendments.
  const exifByAsset = new Map<string, string>();
  if (options.include.exif) {
    const eRes = await pool.query<{
      asset_id: string;
      camera_make: string | null;
      camera_model: string | null;
      taken_at: Date | null;
      gps_label: string | null;
    }>(
      `select asset_id, camera_make, camera_model, taken_at, gps_label
         from asset_exif where asset_id = any($1)`,
      [assetIds],
    );
    for (const e of eRes.rows) {
      const parts = [
        [e.camera_make, e.camera_model].filter(Boolean).join(" ").trim(),
        e.taken_at ? new Date(e.taken_at).toISOString().slice(0, 10) : "",
        e.gps_label ?? "",
      ].filter(Boolean);
      if (parts.length) exifByAsset.set(e.asset_id, parts.join(" · "));
    }
  }

  // 3. Build the PDF.
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(loadPdfFont(), { subset: true });

  const measure: Measure = (text, sz) => font.widthOfTextAtSize(text, sz);

  const size = PAGE_SIZES[options.pageSize];
  const landscape = options.orientation === "landscape";
  const pageW = landscape ? size.h : size.w;
  const pageH = landscape ? size.w : size.h;
  const contentW = pageW - MARGIN * 2;

  const captionOf = (assetId: string): string =>
    options.include.caption
      ? resolveCaptionText(capByAsset.get(assetId) ?? [], options.captionLang, options.captionStyle)
      : "";

  if (options.pageLayout === "grid") {
    // Contact-sheet: 2 columns. Every block the dialog offers is rendered here
    // too — an index + title line, up to two caption lines, one meta line. The
    // title matters most: it is the original filename, so "the third one on page
    // 2" is the only way a client can point at a frame and a photographer can
    // map the reply back. Title/meta are single lines, ellipsized to the cell.
    const cols = 2;
    const gap = 20;
    const cellW = (contentW - gap * (cols - 1)) / cols;
    const imgH = cellW * 0.7;
    const GRID_CAP_LINES = 2;
    const titleH = blockH(options.include.title ? 1 : 0, META_SIZE, 2);
    const capH = blockH(options.include.caption ? GRID_CAP_LINES : 0, CAPTION_SIZE, 4);
    const metaH = blockH(options.include.exif ? 1 : 0, META_SIZE, 2);
    const rowH = imgH + (titleH + capH + metaH || 6) + 14;

    let page = doc.addPage([pageW, pageH]);
    let col = 0;
    let yTop = pageH - MARGIN;
    for (let i = 0; i < rows.length; i++) {
      if (yTop - rowH < MARGIN) {
        page = doc.addPage([pageW, pageH]);
        yTop = pageH - MARGIN;
        col = 0;
      }
      const x = MARGIN + col * (cellW + gap);
      const img = await embedMedium(doc, rows[i].medium_key);
      if (img) {
        const s = fitScale(img.width, img.height, cellW, imgH);
        const w = img.width * s;
        const h = img.height * s;
        page.drawImage(img, { x: x + (cellW - w) / 2, y: yTop - h, width: w, height: h });
      } else {
        page.drawRectangle({ x, y: yTop - imgH, width: cellW, height: imgH, color: PLACEHOLDER });
      }
      let y = yTop - imgH - 2;
      if (options.include.title) {
        const label = `${i + 1} · ${(rows[i].title ?? "").trim()}`.replace(/ · $/, "");
        y = drawLines(page, [truncateToWidth(label, measure, META_SIZE, cellW)], x, y, font, META_SIZE, INK) - 2;
      }
      const cap = captionOf(rows[i].asset_id);
      if (cap) {
        const { lines } = clampLines(wrap(cap, measure, CAPTION_SIZE, cellW), GRID_CAP_LINES);
        y = drawLines(page, lines, x, y, font, CAPTION_SIZE, MUTED) - 2;
      }
      const exif = options.include.exif ? exifByAsset.get(rows[i].asset_id) ?? "" : "";
      if (exif) drawLines(page, [truncateToWidth(exif, measure, META_SIZE, cellW)], x, y, font, META_SIZE, MUTED);
      col += 1;
      if (col >= cols) {
        col = 0;
        yTop -= rowH;
      }
      await progress(8 + Math.round((88 * (i + 1)) / total), `Rendering ${i + 1}/${total}`, i + 1, total);
    }
  } else {
    // One photo per page: large image, then title + caption (+ optional meta).
    for (let i = 0; i < rows.length; i++) {
      const page = doc.addPage([pageW, pageH]);
      const row = rows[i];
      const plan = planPhotoPage(
        pageW,
        pageH,
        {
          title: options.include.title ? (row.title ?? "").trim() : "",
          caption: captionOf(row.asset_id),
          meta: options.include.exif ? exifByAsset.get(row.asset_id) ?? "" : "",
        },
        measure,
      );

      const img = await embedMedium(doc, row.medium_key);
      let yBelow: number;
      if (img) {
        const s = fitScale(img.width, img.height, contentW, plan.imgAreaH);
        const w = img.width * s;
        const h = img.height * s;
        page.drawImage(img, { x: MARGIN + (contentW - w) / 2, y: pageH - MARGIN - h, width: w, height: h });
        yBelow = pageH - MARGIN - h - IMG_TEXT_GAP;
      } else {
        page.drawRectangle({
          x: MARGIN,
          y: pageH - MARGIN - plan.imgAreaH,
          width: contentW,
          height: plan.imgAreaH,
          color: PLACEHOLDER,
        });
        yBelow = pageH - MARGIN - plan.imgAreaH - IMG_TEXT_GAP;
      }

      if (plan.titleLines.length) yBelow = drawLines(page, plan.titleLines, MARGIN, yBelow, font, TITLE_SIZE, INK) - 6;
      if (plan.capLines.length) yBelow = drawLines(page, plan.capLines, MARGIN, yBelow, font, CAPTION_SIZE, INK) - 4;
      if (plan.metaLines.length) drawLines(page, plan.metaLines, MARGIN, yBelow, font, META_SIZE, MUTED);

      await progress(8 + Math.round((88 * (i + 1)) / total), `Rendering ${i + 1}/${total}`, i + 1, total);
    }
  }

  // 4. Store + hand back a long-lived presigned URL via the job payload.
  const pdf = Buffer.from(await doc.save());
  const key = `${job.workspace_id}/exports/${job.id}.pdf`;
  await putObject(key, pdf, "application/pdf");
  const url = await presignGetLong(key, EXPORT_PRESIGN_TTL_SECONDS);
  await pool.query(`update ai_jobs set payload = payload || $1::jsonb where id = $2`, [
    JSON.stringify({ result_url: url }),
    job.id,
  ]);
  await progress(100, "Export ready", total, total);
}
