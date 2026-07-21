import { createHash, randomUUID } from "node:crypto";
import { ingestJobPayloadSchema } from "@archivemind/shared";
import type pg from "pg";
import { extractExif } from "../services/exif";
import { reverseGeocode } from "../services/geocode";
import { DropboxFileError, downloadDropboxLink } from "../services/dropbox";
import { DriveFileError, downloadDriveFile, getDriveFileMeta } from "../services/gdrive";
import { heicToRaw } from "../services/heic";
import { makePreviews, previewKey, type PreviewInput } from "../services/previews";
import { deleteObject, getObjectBuffer, putObject } from "../services/r2";
import { isRawFilename, rawToJpeg } from "../services/raw";
import { DriveTokenError, DriveTokenSource } from "../services/tokens";
import type { HandlerContext } from "./index";

/** Ingest (spec §8.1), per asset: stream bytes → sha256 dedup → EXIF →
 *  decode (sharp / heic-decode / RAW cascade) → previews to R2 →
 *  asset_exif + asset_previews rows → auto-enqueue analyze for the batch.
 *  Sequential on purpose: HEIC decode can take ~200 MB RAM per file.
 *
 *  Byte sources (ADR 0025): uploads and Dropbox originals come from R2
 *  (r2_key); Drive-linked files (origin='gdrive', r2_key null) are streamed
 *  from Drive at processing time and their originals are NEVER stored —
 *  TECH_SPEC §6. */

interface AssetRow {
  asset_id: string;
  workspace_id: string;
  title: string | null;
  file_id: string;
  r2_key: string | null;
  mime_type: string | null;
  origin: string;
  source_connection_id: string | null;
  source_file_id: string | null;
  content_hash: string | null;
  preview_count: number;
}

/** Drive originals we refuse to pull into worker RAM (whole-file Buffer). */
const MAX_IMPORT_BYTES = Number(process.env.MAX_IMPORT_BYTES ?? 200 * 1024 * 1024);

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
  const payload = ingestJobPayloadSchema.parse(job.payload);
  const { asset_ids } = payload;
  const dropboxByAsset = new Map((payload.dropbox ?? []).map((d) => [d.asset_id, d]));

  const { rows } = await pool.query<AssetRow>(
    `select a.id as asset_id, a.workspace_id, a.title,
            f.id as file_id, f.r2_key, f.mime_type,
            f.origin, f.source_connection_id, f.source_file_id, f.content_hash,
            (select count(*)::int from asset_previews ap where ap.asset_id = a.id) as preview_count
     from assets a
     join files f on f.asset_id = a.id
     where a.id = any($1::uuid[])
     order by a.created_at`,
    [asset_ids],
  );

  const tokens = new DriveTokenSource(pool);
  const analyzeIds: string[] = [];
  let done = 0;
  let failed = 0;
  let deduped = 0;

  for (const row of rows) {
    const label = row.title ?? row.asset_id;
    await progress(Math.round((done / rows.length) * 100), `Processing ${label}`, done, rows.length);

    let buf: Buffer;
    if (!row.r2_key) {
      // Resume guard (both cloud origins): a re-run — retry after partial
      // failure, or an explicit re-ingest — must not re-fetch files that
      // already made it through.
      if (row.content_hash && row.preview_count >= 2) {
        done += 1;
        continue;
      }
      if (row.origin === "dropbox") {
        // ADR 0008: fetch the ~4 h Chooser link ONCE, store the original in
        // R2 exactly like an upload; from then on the asset is R2-backed.
        const pick = dropboxByAsset.get(row.asset_id);
        try {
          // A retried/re-enqueued job without a usable link (payload from an
          // expired window) behaves like the link expiring: re-pick heals.
          if (!pick) throw new DropboxFileError("dropbox_link_expired");
          buf = await downloadDropboxLink(pick.link, MAX_IMPORT_BYTES);
          const key = dropboxOriginalKey(row.workspace_id, pick.name);
          await putObject(key, buf, row.mime_type ?? "application/octet-stream");
          await pool.query(`update files set r2_key = $2, byte_size = $3 where id = $1`, [
            row.file_id,
            key,
            buf.length,
          ]);
          row.r2_key = key; // the dedup branch below may delete this fresh object
        } catch (err) {
          if (err instanceof DropboxFileError && err.code === "dropbox_file_too_large") {
            // Final state, like an undecodable upload: kept, but no previews/AI.
            await pool.query(`update assets set kind='other' where id = $1`, [row.asset_id]);
            console.log(`[ingest] ${label}: over MAX_IMPORT_BYTES → kind='other'`);
          } else {
            const code = err instanceof DropboxFileError ? err.code : "dropbox_download_failed";
            console.log(`[ingest] ${label}: ${code} — skipped this run`);
            failed += 1;
          }
          done += 1;
          continue;
        }
      } else if (row.origin !== "gdrive" || !row.source_connection_id || !row.source_file_id) {
        done += 1; // unknown cloud origin — nothing to stream from yet
        continue;
      } else {
      try {
        buf = await downloadWithTokenRetry(tokens, row.source_connection_id, row.source_file_id);
        if (buf.length !== 0) {
          await pool.query(`update files set byte_size = $2 where id = $1`, [
            row.file_id,
            buf.length,
          ]);
        }
      } catch (err) {
        if (err instanceof DriveTokenError) throw err; // whole connection is dead — fail the job
        if (err instanceof DriveFileError && err.code === "drive_file_not_found") {
          // Spec §12: the source no longer has the file (or the grant is gone).
          await pool.query(`update assets set status='source_missing' where id = $1`, [
            row.asset_id,
          ]);
          console.log(`[ingest] ${label}: drive_file_not_found → source_missing`);
          failed += 1;
        } else if (err instanceof DriveFileError && err.code === "drive_file_too_large") {
          // Final state, like an undecodable upload: kept, but no previews/AI.
          await pool.query(`update assets set kind='other' where id = $1`, [row.asset_id]);
          console.log(`[ingest] ${label}: over MAX_IMPORT_BYTES → kind='other'`);
        } else {
          const code = err instanceof DriveFileError ? err.code : "drive_download_failed";
          console.log(`[ingest] ${label}: ${code} — skipped this run`);
          failed += 1;
        }
        done += 1;
        continue;
      }
      }
    } else {
      buf = await getObjectBuffer(row.r2_key);
    }

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
      // The doomed asset's project links move to the survivor FIRST — a Drive
      // copy of an already-uploaded photo was just imported into a project,
      // and "silently vanishes from that project" is not acceptable dedup UX
      // (assets are M:N to projects, ADR 0011).
      await pool.query(
        `insert into project_assets (project_id, asset_id)
         select pa.project_id, $2 from project_assets pa where pa.asset_id = $1
         on conflict do nothing`,
        [row.asset_id, dupes[0].asset_id],
      );
      await pool.query(`delete from files where id = $1`, [row.file_id]);
      await pool.query(
        `delete from assets a where a.id = $1
           and not exists (select 1 from files f where f.asset_id = a.id)`,
        [row.asset_id],
      );
      if (row.r2_key) await deleteObject(row.r2_key).catch(() => {}); // best-effort cleanup
      console.log(`[ingest] ${label}: duplicate of asset ${dupes[0].asset_id} — merged into it`);
      deduped += 1;
      done += 1;
      continue;
    }
    await pool.query(`update files set content_hash = $2 where id = $1`, [row.file_id, hash]);

    // EXIF describes the shot → hangs off the ASSET (ADR 0011)
    const exif = await extractExif(buf, row.title ?? "");
    if (exif) {
      // Offline reverse geocode (ADR 0026) — no network, and null rather than
      // a guess, so an unlabelled asset is always "we don't know" and never
      // "somewhere plausible". "" records that we looked and found nothing,
      // which is what keeps the backfill from re-scanning it forever.
      const place = reverseGeocode(exif.gps_lat, exif.gps_lon);
      await pool.query(
        `insert into asset_exif (asset_id, taken_at, camera_make, camera_model, lens,
                                 gps_lat, gps_lon, gps_label, location_source, iso, aperture,
                                 shutter, focal_length, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (asset_id) do update set
           taken_at=excluded.taken_at, camera_make=excluded.camera_make,
           camera_model=excluded.camera_model, lens=excluded.lens,
           gps_lat=excluded.gps_lat, gps_lon=excluded.gps_lon,
           gps_label=excluded.gps_label,
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
          exif.gps_lat != null && exif.gps_lon != null ? (place?.label ?? "") : null,
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

  const tail = [
    deduped > 0 ? `${deduped} deduped` : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(", ");
  await progress(100, `Processed ${done} file(s)${tail ? ` (${tail})` : ""}`, done, rows.length);

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

/** ADR 0008: Dropbox originals land in R2 under the same layout uploads use
 *  (spec §6, mirrors apps/web/lib/r2.ts originalKey — keep the sanitize rules
 *  in sync). */
function dropboxOriginalKey(workspaceId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 200) || "file";
  return `${workspaceId}/originals/${randomUUID()}/${safe}`;
}

/** Drive bytes with a size guard (metadata first — 5 units beats a wasted
 *  200-unit oversize download) and a single re-mint on a token that expired
 *  mid-batch (long serial batches CAN outlive the ~1h access token). */
async function downloadWithTokenRetry(
  tokens: DriveTokenSource,
  connectionId: string,
  sourceFileId: string,
): Promise<Buffer> {
  const token = await tokens.getAccessToken(connectionId);
  try {
    const meta = await getDriveFileMeta(sourceFileId, token);
    if (meta.size != null && meta.size > MAX_IMPORT_BYTES) {
      throw new DriveFileError("drive_file_too_large");
    }
    return await downloadDriveFile(sourceFileId, token);
  } catch (err) {
    if (err instanceof DriveFileError && err.code === "drive_token_expired") {
      tokens.invalidate(connectionId);
      const fresh = await tokens.getAccessToken(connectionId);
      return await downloadDriveFile(sourceFileId, fresh);
    }
    throw err;
  }
}
