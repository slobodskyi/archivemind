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
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.42, 0.42, 0.42);
const PLACEHOLDER = rgb(0.9, 0.9, 0.9);

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (cur && font.widthOfTextAtSize(trial, size) > maxW) {
        out.push(cur);
        cur = w;
      } else {
        cur = trial;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
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
  const factsByAsset = new Map<string, string[]>();
  if (options.include.facts) {
    const fRes = await pool.query<{ asset_id: string; text: string }>(
      `select asset_id, text from facts where asset_id = any($1) order by asset_id`,
      [assetIds],
    );
    for (const f of fRes.rows) {
      const arr = factsByAsset.get(f.asset_id) ?? [];
      arr.push(f.text);
      factsByAsset.set(f.asset_id, arr);
    }
  }
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
    // Contact-sheet: 2 columns, images with a one-line caption under each.
    const cols = 2;
    const gap = 20;
    const cellW = (contentW - gap * (cols - 1)) / cols;
    const imgH = cellW * 0.7;
    const capH = options.include.caption ? CAPTION_SIZE * LINE_GAP * 2 + 4 : 6;
    const rowH = imgH + capH + 14;

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
        const s = Math.min(cellW / img.width, imgH / img.height);
        const w = img.width * s;
        const h = img.height * s;
        page.drawImage(img, { x: x + (cellW - w) / 2, y: yTop - h, width: w, height: h });
      } else {
        page.drawRectangle({ x, y: yTop - imgH, width: cellW, height: imgH, color: PLACEHOLDER });
      }
      const cap = captionOf(rows[i].asset_id);
      if (cap) drawLines(page, wrap(cap, font, CAPTION_SIZE, cellW).slice(0, 2), x, yTop - imgH - 2, font, CAPTION_SIZE, MUTED);
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
      const title = options.include.title ? (row.title ?? "").trim() : "";
      const cap = captionOf(row.asset_id);
      const facts = options.include.facts ? factsByAsset.get(row.asset_id) ?? [] : [];
      const exif = options.include.exif ? exifByAsset.get(row.asset_id) ?? "" : "";

      // Reserve room below the image for the text block.
      const titleLines = title ? wrap(title, font, TITLE_SIZE, contentW) : [];
      const capLines = cap ? wrap(cap, font, CAPTION_SIZE, contentW) : [];
      const factLines = facts.flatMap((f) => wrap(`• ${f}`, font, META_SIZE, contentW));
      const metaLines = exif ? wrap(exif, font, META_SIZE, contentW) : [];
      const textH =
        (titleLines.length ? titleLines.length * TITLE_SIZE * LINE_GAP + 6 : 0) +
        (capLines.length ? capLines.length * CAPTION_SIZE * LINE_GAP + 4 : 0) +
        (factLines.length ? factLines.length * META_SIZE * LINE_GAP + 4 : 0) +
        (metaLines.length ? metaLines.length * META_SIZE * LINE_GAP + 4 : 0);

      const imgAreaH = pageH - MARGIN * 2 - textH - 16;
      const img = await embedMedium(doc, row.medium_key);
      let yBelow = pageH - MARGIN;
      if (img) {
        const s = Math.min(contentW / img.width, imgAreaH / img.height);
        const w = img.width * s;
        const h = img.height * s;
        page.drawImage(img, { x: MARGIN + (contentW - w) / 2, y: pageH - MARGIN - h, width: w, height: h });
        yBelow = pageH - MARGIN - h - 16;
      } else {
        page.drawRectangle({ x: MARGIN, y: pageH - MARGIN - imgAreaH, width: contentW, height: imgAreaH, color: PLACEHOLDER });
        yBelow = pageH - MARGIN - imgAreaH - 16;
      }

      if (titleLines.length) yBelow = drawLines(page, titleLines, MARGIN, yBelow, font, TITLE_SIZE, INK) - 6;
      if (capLines.length) yBelow = drawLines(page, capLines, MARGIN, yBelow, font, CAPTION_SIZE, INK) - 4;
      if (factLines.length) yBelow = drawLines(page, factLines, MARGIN, yBelow, font, META_SIZE, MUTED) - 4;
      if (metaLines.length) drawLines(page, metaLines, MARGIN, yBelow, font, META_SIZE, MUTED);

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
