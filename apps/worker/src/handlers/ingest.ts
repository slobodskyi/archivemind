import { createHash } from "node:crypto";
import { ingestJobPayloadSchema } from "@archivemind/shared";
import type pg from "pg";
import { extractExif } from "../services/exif";
import { heicToRaw } from "../services/heic";
import { makePreviews, previewKey, type PreviewInput } from "../services/previews";
import { deleteObject, getObjectBuffer, putObject } from "../services/r2";
import { isRawFilename, rawToJpeg } from "../services/raw";
import type { HandlerContext } from "./index";

/** Ingest (spec §8.1), per asset: stream bytes → sha256 dedup → EXIF →
 *  decode (sharp / heic-decode / RAW cascade) → previews to R2 →
 *  asset_exif + asset_previews rows → auto-enqueue analyze for the batch.
 *  Sequential on purpose: HEIC decode can take ~200 MB RAM per file. */

interface AssetRow {
  asset_id: string;
  workspace_id: string;
  title: string | null;
  file_id: string;
  r2_key: string | null;
  mime_type: string | null;
}

const SHARP_MIMES = /^image\/(jpeg|png|webp|tiff|gif|avif)$/;
const HEIC_MIMES = /^image\/(heic|heif)$/;

type Decoded =
  | { ok: true; input: PreviewInput }
  | { ok: false; reason: string };

/** Exposed for unit tests: which decode path a file takes. */
export function decodeRoute(mime: string | null, filename: string): "sharp" | "heic" | "raw" | "pdf" | "skip" {
  const m = mime ?? "";
  if (HEIC_MIMES.test(m)) return "heic";
  if (isRawFilename(filename)) return "raw";
  if (SHARP_MIMES.test(m)) return "sharp";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "sharp"; // let sharp try unknown image/*
  return "skip";
}

async function decodeBytes(buf: Buffer, mime: string | null, filename: string): Promise<Decoded> {
  switch (decodeRoute(mime, filename)) {
    case "heic": {
      const raw = await heicToRaw(buf);
      return { ok: true, input: { kind: "raw", ...raw } };
    }
    case "raw": {
      const jpeg = await rawToJpeg(buf, filename);
      return jpeg
        ? { ok: true, input: { kind: "encoded", data: jpeg } }
        : { ok: false, reason: "no embedded preview in RAW" };
    }
    case "sharp":
      return { ok: true, input: { kind: "encoded", data: buf } };
    case "pdf":
      return { ok: false, reason: "pdf preview lands with the QA slice (#9)" };
    default:
      return { ok: false, reason: `unsupported type ${mime ?? "unknown"}` };
  }
}

export async function ingestHandler({ pool, job, progress }: HandlerContext): Promise<void> {
  const { asset_ids } = ingestJobPayloadSchema.parse(job.payload);

  const { rows } = await pool.query<AssetRow>(
    `select a.id as asset_id, a.workspace_id, a.title,
            f.id as file_id, f.r2_key, f.mime_type
     from assets a
     join files f on f.asset_id = a.id
     where a.id = any($1::uuid[])
     order by a.created_at`,
    [asset_ids],
  );

  const analyzeIds: string[] = [];
  let done = 0;

  for (const row of rows) {
    const label = row.title ?? row.asset_id;
    await progress(Math.round((done / rows.length) * 100), `Processing ${label}`, done, rows.length);

    if (!row.r2_key) {
      done += 1; // cloud-linked files stream at Phase 6; nothing to do yet
      continue;
    }

    const buf = await getObjectBuffer(row.r2_key);

    // sha256 + dedup. files_dedup_idx is UNIQUE (workspace_id, content_hash) —
    // the schema allows exactly ONE file row per distinct content, so a
    // duplicate upload is dropped entirely: file row, its now-empty asset, and
    // the redundant R2 original. The already-ingested asset stands.
    const hash = createHash("sha256").update(buf).digest("hex");
    const { rows: dupes } = await pool.query(
      `select f.id as file_id, f.asset_id from files f
       where f.workspace_id = $1 and f.content_hash = $2 and f.id <> $3
       limit 1`,
      [row.workspace_id, hash, row.file_id],
    );
    if (dupes.length > 0) {
      await pool.query(`delete from files where id = $1`, [row.file_id]);
      await pool.query(
        `delete from assets a where a.id = $1
           and not exists (select 1 from files f where f.asset_id = a.id)`,
        [row.asset_id],
      );
      await deleteObject(row.r2_key).catch(() => {}); // best-effort cleanup
      console.log(`[ingest] ${label}: duplicate of asset ${dupes[0].asset_id} — dropped`);
      done += 1;
      continue;
    }
    await pool.query(`update files set content_hash = $2 where id = $1`, [row.file_id, hash]);

    // EXIF describes the shot → hangs off the ASSET (ADR 0011)
    const exif = await extractExif(buf);
    if (exif) {
      await pool.query(
        `insert into asset_exif (asset_id, taken_at, camera_make, camera_model, lens,
                                 gps_lat, gps_lon, location_source, iso, aperture, shutter,
                                 focal_length, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (asset_id) do update set
           taken_at=excluded.taken_at, camera_make=excluded.camera_make,
           camera_model=excluded.camera_model, lens=excluded.lens,
           gps_lat=excluded.gps_lat, gps_lon=excluded.gps_lon,
           location_source=excluded.location_source, iso=excluded.iso,
           aperture=excluded.aperture, shutter=excluded.shutter,
           focal_length=excluded.focal_length, raw=excluded.raw`,
        [
          row.asset_id,
          exif.taken_at,
          exif.camera_make,
          exif.camera_model,
          exif.lens,
          exif.gps_lat,
          exif.gps_lon,
          exif.gps_lat != null ? "gps" : null,
          exif.iso,
          exif.aperture,
          exif.shutter,
          exif.focal_length,
          JSON.stringify(exif.raw),
        ],
      );
    }

    const decoded = await decodeBytes(buf, row.mime_type, row.title ?? "");
    if (!decoded.ok) {
      // Spec §8.1: undecodable → kind='other', AI skipped.
      await pool.query(`update assets set kind='other' where id = $1`, [row.asset_id]);
      console.log(`[ingest] ${label}: no previews (${decoded.reason})`);
      done += 1;
      continue;
    }

    for (const p of await makePreviews(decoded.input)) {
      const key = previewKey(row.workspace_id, row.asset_id, p.size);
      await putObject(key, p.data, "image/webp");
      await pool.query(
        `insert into asset_previews (asset_id, size, r2_key, width, height)
         values ($1,$2,$3,$4,$5)
         on conflict (asset_id, size) do update set
           r2_key=excluded.r2_key, width=excluded.width, height=excluded.height`,
        [row.asset_id, p.size, key, p.width, p.height],
      );
    }

    analyzeIds.push(row.asset_id);
    done += 1;
  }

  await progress(100, `Processed ${done} file(s)`, done, rows.length);

  // Analyze is an EXPLICIT user action (selection → POST /api/jobs) — product
  // decision 2026-07-10: every analyze call costs money, so the user stays in
  // control. ANALYZE_ON_INGEST=true flips back to spec §8.1's original
  // analyze-on-ingest behavior for dev/testing.
  if (process.env.ANALYZE_ON_INGEST === "true" && analyzeIds.length > 0) {
    await pool.query(
      `insert into ai_jobs (workspace_id, user_id, type, payload, total_items, done_items)
       values ($1, $2, 'analyze', $3, $4, 0)`,
      [job.workspace_id, job.user_id, JSON.stringify({ asset_ids: analyzeIds }), analyzeIds.length],
    );
  }
}
