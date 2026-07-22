import { createHash, randomUUID } from "node:crypto";
import { ingestJobPayloadSchema } from "@archivemind/shared";
import type pg from "pg";
import { extractExif } from "../services/exif";
import { isGeocodeIndexAvailable, reverseGeocode } from "../services/geocode";
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
  has_exif: boolean;
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

/** Pure ingest decisions (exported for unit tests, like decodeRoute). */

export type DedupAction = "merge" | "revive-merge" | "stand-alone";

/** #118: what to do when an incoming file's content hash already exists in the
 *  workspace. files_dedup_idx is UNIQUE (workspace_id, content_hash) — exactly
 *  ONE file may hold a given hash — so the survivor either swallows the
 *  incoming copy or must first release its claim on the hash.
 *
 *  Two things are dangerous and must never happen (both were found by review):
 *   - Merging a fresh copy INTO a deleted/source_missing tombstone destroyed
 *     the re-added photo — the survivor was a record no view renders.
 *   - Dropping the incoming DURABLE R2 original (an upload / Dropbox byte in
 *     R2) in favour of a survivor that holds NO durable bytes of its own (a
 *     Drive row — r2_key is always null, ADR 0025 — or a source_missing record
 *     whose source is gone) throws away the only recoverable copy the user
 *     just supplied, leaving an active-but-unrenderable asset.
 *
 *  So:
 *   - source_missing survivor → never fold into a permanently broken record:
 *     stand-alone (the incoming file wins; the tombstone releases the hash).
 *   - incoming is durable but the survivor is NOT → stand-alone: protect the
 *     durable original (accepts a rare duplicate over destroying good bytes).
 *   - otherwise the survivor is a safe home: merge into it (drop the
 *     duplicate), reviving a soft-deleted survivor — "re-added to get it back". */
export function dedupDecision(
  survivorStatus: string,
  survivorDurable: boolean,
  incomingDurable: boolean,
): DedupAction {
  if (survivorStatus === "source_missing") return "stand-alone";
  if (incomingDurable && !survivorDurable) return "stand-alone";
  return survivorStatus === "active" ? "merge" : "revive-merge";
}

/** #119: a run in which EVERY processed row failed is a FAILED job, not a
 *  silent 'done' with error=null. deduped / kind='other' / source_missing /
 *  resume-skipped rows never touch `failed`, so failed === total means nothing
 *  survived and nothing was even handled — the only case worth retrying/failing. */
export function isWhollyFailed(total: number, failed: number): boolean {
  return total > 0 && failed === total;
}

/** The per-run progress tail: "Processed N file(s) (X deduped, Y failed, Z missing)". */
export function ingestProgressLabel(
  done: number,
  deduped: number,
  failed: number,
  missing: number,
): string {
  const tail = [
    deduped > 0 ? `${deduped} deduped` : null,
    failed > 0 ? `${failed} failed` : null,
    missing > 0 ? `${missing} missing` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `Processed ${done} file(s)${tail ? ` (${tail})` : ""}`;
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
            (select count(*)::int from asset_previews ap where ap.asset_id = a.id) as preview_count,
            exists (select 1 from asset_exif ae where ae.asset_id = a.id) as has_exif
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
  // Handled-terminal outcome, distinct from `failed`: the source lost the file
  // (drive_file_not_found → source_missing). Retrying can't heal it, so it must
  // NOT drive the wholly-failed job retry — but the user still needs to see it.
  let missing = 0;

  for (const row of rows) {
    const label = row.title ?? row.asset_id;
    await progress(Math.round((done / rows.length) * 100), `Processing ${label}`, done, rows.length);

    let buf: Buffer;
    if (!row.r2_key) {
      // Resume guard (both cloud origins): a re-run — retry after partial
      // failure, or an explicit re-ingest — must not re-fetch files that
      // already made it through.
      //
      // "Made it through" has to include metadata, not just bytes. Without
      // the asset_exif check, a Drive-origin file whose EXIF extraction
      // failed was skipped here before extraction was even retried — so the
      // iPhone HEIC bug (#113) was permanent for exactly those files, and no
      // amount of re-ingesting could heal them.
      if (row.content_hash && row.preview_count >= 2 && row.has_exif) {
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
          // A HANDLED terminal state — retrying the whole job can't heal it, so
          // it counts as `missing`, not `failed` (which would trip the
          // wholly-failed retry and re-hit the Drive API 3× for nothing), just
          // like the drive_file_too_large sibling below.
          await pool.query(`update assets set status='source_missing' where id = $1`, [
            row.asset_id,
          ]);
          console.log(`[ingest] ${label}: drive_file_not_found → source_missing`);
          missing += 1;
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
      try {
        buf = await getObjectBuffer(row.r2_key);
      } catch (err) {
        // A missing object or a transient R2 5xx must fail THIS asset, not
        // throw out of the loop and abandon every file after it (#116). The
        // asset keeps no content_hash, so a re-import heals it (resume guard).
        console.log(`[ingest] ${label}: ingest_bytes_missing — ${String(err)}`);
        failed += 1;
        done += 1;
        continue;
      }
    }

    // #117: NEVER hash or store an empty buffer. sha256("") is the well-known
    // e3b0c442… constant; written into files.content_hash (UNIQUE per
    // workspace) it turns the first 0-byte file into a dedup black hole that
    // silently merges — and destroys — every later empty file. Refuse it
    // before the hash: it never reaches the dedup index.
    if (buf.length === 0) {
      console.log(`[ingest] ${label}: ingest_empty_file — 0 bytes, skipped`);
      failed += 1;
      done += 1;
      continue;
    }

    // sha256 + status-and-durability-aware dedup (#118), contained per-asset
    // (#116). files_dedup_idx is UNIQUE (workspace_id, content_hash) — exactly
    // ONE file row may hold a given hash — so a real duplicate is dropped
    // entirely (file row, its now-empty asset, redundant R2 original), while a
    // survivor that can't safely swallow the incoming copy first RELEASES its
    // claim on the hash so the incoming file can stand on its own.
    const hash = createHash("sha256").update(buf).digest("hex");
    try {
      const { rows: dupes } = await pool.query<{
        file_id: string;
        asset_id: string;
        asset_status: string;
        r2_key: string | null;
      }>(
        `select f.id as file_id, f.asset_id, a.status as asset_status, f.r2_key
         from files f join assets a on a.id = f.asset_id
         where f.workspace_id = $1 and f.content_hash = $2 and f.id <> $3
         limit 1`,
        [row.workspace_id, hash, row.file_id],
      );
      if (dupes.length > 0) {
        const survivor = dupes[0];
        const action = dedupDecision(
          survivor.asset_status,
          survivor.r2_key != null, // survivor holds durable bytes in R2
          row.r2_key != null, // the incoming file holds durable bytes in R2
        );
        if (action === "stand-alone") {
          // The survivor is a tombstone, or holds no durable bytes while the
          // incoming file DOES — folding the copy in would either resurrect a
          // broken record or destroy the only recoverable original the user
          // just supplied. Release the survivor's claim on the hash (UNIQUE)
          // and let the incoming file proceed as its own asset. A rare
          // duplicate is strictly better than silent data loss.
          await pool.query(`update files set content_hash = null where id = $1`, [survivor.file_id]);
          console.log(
            `[ingest] ${label}: matches ${survivor.asset_status} asset ${survivor.asset_id} that holds no durable copy — kept separately`,
          );
        } else {
          if (action === "revive-merge") {
            // Re-adding a soft-deleted photo means "get it back": revive the
            // survivor rather than merging the fresh copy INTO a tombstone
            // (which used to delete the re-added photo, #118). Safe only
            // because the survivor has durable bytes (checked above).
            await pool.query(`update assets set status='active' where id = $1`, [survivor.asset_id]);
          }
          // The doomed asset's project links move to the survivor FIRST — a
          // re-imported copy was just added to a project, and "silently
          // vanishes from that project" is not acceptable dedup UX (M:N,
          // ADR 0011).
          await pool.query(
            `insert into project_assets (project_id, asset_id)
             select pa.project_id, $2 from project_assets pa where pa.asset_id = $1
             on conflict do nothing`,
            [row.asset_id, survivor.asset_id],
          );
          await pool.query(`delete from files where id = $1`, [row.file_id]);
          await pool.query(
            `delete from assets a where a.id = $1
               and not exists (select 1 from files f where f.asset_id = a.id)`,
            [row.asset_id],
          );
          if (row.r2_key) await deleteObject(row.r2_key).catch(() => {}); // best-effort cleanup
          console.log(
            action === "revive-merge"
              ? `[ingest] ${label}: duplicate of ${survivor.asset_status} asset ${survivor.asset_id} — revived and merged`
              : `[ingest] ${label}: duplicate of asset ${survivor.asset_id} — merged into it`,
          );
          deduped += 1;
          done += 1;
          continue;
        }
      }
      await pool.query(`update files set content_hash = $2 where id = $1`, [row.file_id, hash]);
    } catch (err) {
      // A DB hiccup on one row must not abandon the rest of the batch (#116).
      console.log(`[ingest] ${label}: ingest_dedup_failed — ${String(err)}`);
      failed += 1;
      done += 1;
      continue;
    }

    // EXIF describes the shot → hangs off the ASSET (ADR 0011). Contained
    // per-asset (#116): extractExif never throws (it swallows corrupt/absent
    // EXIF and returns null), but the asset_exif upsert and JSON.stringify CAN
    // throw (a transient DB fault, a non-serialisable EXIF value) — and this
    // block sits between the two other guards, so an uncaught throw here would
    // abandon the rest of the batch. EXIF is best-effort metadata: on failure,
    // skip it and still generate previews. has_exif stays false, so a cloud
    // re-import retries the extraction (the #113 heal path).
    try {
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
          // "" records "we looked and found nothing" — the sentinel the
          // backfill uses to stop re-examining wilderness shots. It must NOT
          // be written when the index simply failed to load, or every asset
          // ingested during that outage is permanently marked done and the
          // backfill (queue: gps_label is null) can never revisit it.
          exif.gps_lat != null && exif.gps_lon != null
            ? (place?.label ?? (isGeocodeIndexAvailable() ? "" : null))
            : null,
          exif.gps_lat != null ? "gps" : null,
          exif.iso,
          exif.aperture,
          exif.shutter,
          exif.focal_length,
          JSON.stringify(exif.raw),
        ],
      );
    }
    } catch (err) {
      console.log(`[ingest] ${label}: ingest_exif_failed — ${String(err)} — previews still generated`);
    }

    // Decode + previews, contained per-asset (#116). A HEIC heic-decode can't
    // handle, a truncated/mislabelled JPEG (the MIME is client-supplied and
    // never sniffed), or a sharp/R2 hiccup THROWS here — it must fail THIS
    // asset, not escape the loop and abandon every file after it. This is the
    // asymmetry #116 flagged: a graceful {ok:false} (PDF, RAW without an
    // embedded preview) already degrades to kind='other'; a throw did not.
    try {
      const decoded = await decodeBytes(buf, row.mime_type, row.title ?? "");
      if (!decoded.ok) {
        // Spec §8.1: undecodable → kind='other', AI skipped. Not a failure —
        // a legitimately non-previewable file (kept, just no derivatives).
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
    } catch (err) {
      // content_hash was written above (before EXIF/previews), so this asset
      // now has a hash but zero previews — an unrenderable shell. Left as-is it
      // becomes a valid dedup survivor: a user re-uploading the same bytes to
      // fix it would be merged INTO the shell and silently heal nothing. Clear
      // the hash so the incomplete asset stops attracting dedup and a re-import
      // ingests cleanly instead. Best-effort — never re-throw out of the catch.
      await pool
        .query(`update files set content_hash = null where id = $1`, [row.file_id])
        .catch(() => {});
      console.log(`[ingest] ${label}: ingest_decode_failed — ${String(err)}`);
      failed += 1;
      done += 1;
      continue;
    }

    analyzeIds.push(row.asset_id);
    done += 1;
  }

  await progress(100, ingestProgressLabel(done, deduped, failed, missing), done, rows.length);

  // #119: a run in which EVERY asset failed must be a FAILED job, not a silent
  // 'done' with error=null (the mechanism that hid the iPhone HEIC bug #113).
  // deduped / kind='other' / resume-skipped rows all count as survival, so
  // this fires only when nothing at all got through. Partial failures stay
  // 'done' and carry the "N failed" count in progress_label (surfaced in the
  // web toast). A first-party code — never a raw sharp/AWS message.
  if (isWhollyFailed(rows.length, failed)) {
    throw new Error("ingest_all_failed");
  }

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
