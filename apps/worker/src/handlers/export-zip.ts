import { ZIP_MAX_TOTAL_BYTES, type ArtboardSettings } from "@archivemind/shared";
import type pg from "pg";
import { getObjectBuffer } from "../services/r2";
import { buildZip, uniqueEntryName, type ZipEntry } from "../services/zip";
import { renderCaptionsCsv } from "./export-csv";
import type { ExportRow } from "./export";

/** ZIP bundle export — "pick some files, get a zip".
 *
 *  Two shapes (`options.zipContents`):
 *
 *  - `originals` — the real file for every source that has one in R2 (upload,
 *    Dropbox). A **Drive-linked asset has no original in R2 at all** (ADR 0025:
 *    the worker streams Drive bytes at processing time and never stores them), so
 *    those fall back to the web-size preview and are NAMED in the archive's
 *    README. That is what TECH_SPEC §8.5 prescribed ("owned original files where
 *    present, else medium previews + note") and it beats both alternatives:
 *    silently shipping a preview as if it were the original, or failing the whole
 *    bundle because one asset came from Drive.
 *  - `web` — the 1024px previews for everything. ~100–300 KB each, so a
 *    500-photo bundle lands around 50–150 MB and can actually be emailed.
 *
 *  captions.csv rides inside either shape, so the metadata travels with the
 *  pixels and the recipient needs nothing from us to read it.
 *
 *  SIZE IS CHECKED BEFORE ANY BYTES ARE FETCHED. `putObject` takes a Buffer and
 *  there is no multipart upload anywhere in the repo, so the archive is fully in
 *  memory; a RAW archive would OOM, and an OOM is a SIGKILL that skips
 *  failOrRetryJob and leaves the row for reapStaleJobs to requeue every ~15
 *  minutes, forever, taking the single-threaded worker down each cycle. A refused
 *  job the user can act on is strictly better. */

interface ByteRow {
  asset_id: string;
  title: string | null;
  /** Original in R2 — null for Drive-linked files (ADR 0025). */
  original_key: string | null;
  byte_size: string | number | null;
  medium_key: string | null;
  medium_size: string | number | null;
}

const num = (v: string | number | null): number =>
  v == null ? 0 : typeof v === "number" ? v : Number.parseInt(v, 10) || 0;

export interface ZipPlanEntry {
  assetId: string;
  key: string;
  name: string;
  bytes: number;
  /** True when this is a preview standing in for a missing original. */
  substituted: boolean;
}

export interface ZipPlan {
  entries: ZipPlanEntry[];
  totalBytes: number;
  /** Assets with nothing to ship at all (ingest hasn't run, or it failed). */
  missing: string[];
}

/** Decide what goes in the archive, and how big it will be, without fetching.
 *  Pure over the DB rows so the size guard and the substitution rules are
 *  testable. */
export function planZip(rows: readonly ByteRow[], contents: ArtboardSettings["zipContents"]): ZipPlan {
  const taken = new Set<string>();
  const entries: ZipPlanEntry[] = [];
  const missing: string[] = [];
  let totalBytes = 0;

  for (const row of rows) {
    const wantOriginal = contents === "originals" && row.original_key;
    const key = wantOriginal ? row.original_key : row.medium_key;
    if (!key) {
      missing.push(row.title ?? row.asset_id);
      continue;
    }
    const substituted = contents === "originals" && !row.original_key;
    // A preview is always webp; only an original keeps its own extension.
    const base = (row.title ?? row.asset_id).trim() || row.asset_id;
    const name = uniqueEntryName(
      wantOriginal ? base : `${base.replace(/\.[^.]+$/, "")}.webp`,
      taken,
    );
    const bytes = num(wantOriginal ? row.byte_size : row.medium_size);
    entries.push({ assetId: row.asset_id, key, name, bytes, substituted });
    totalBytes += bytes;
  }

  return { entries, totalBytes, missing };
}

/** The note that explains anything the archive could not deliver as asked. */
export function buildReadme(plan: ZipPlan, contents: ArtboardSettings["zipContents"]): string | null {
  const substituted = plan.entries.filter((e) => e.substituted);
  if (substituted.length === 0 && plan.missing.length === 0) return null;

  const lines = ["ArchiveMind export", ""];
  if (substituted.length > 0) {
    lines.push(
      `${substituted.length} file(s) are web-size previews (1024px), not originals.`,
      "They were imported as Google Drive links, so the original file was never",
      "copied into ArchiveMind — it still lives in that Drive account.",
      "",
      ...substituted.map((e) => `  - ${e.name}`),
      "",
    );
  }
  if (plan.missing.length > 0) {
    lines.push(
      `${plan.missing.length} file(s) could not be included at all — they have no`,
      "stored copy yet, which usually means processing has not finished.",
      "",
      ...plan.missing.map((m) => `  - ${m}`),
      "",
    );
  }
  if (contents === "web") {
    lines.push("Every image in this archive is a 1024px preview.", "");
  }
  return lines.join("\n");
}

export async function renderZip(
  pool: pg.Pool,
  rows: ExportRow[],
  options: ArtboardSettings,
  onProgress: (done: number, total: number) => Promise<void>,
): Promise<{ body: Buffer; skipped: number }> {
  const assetIds = rows.map((r) => r.asset_id);

  // One original per asset (the durable one if several files exist), plus the
  // medium preview as the fallback / the 'web' payload.
  const byteRes = await pool.query<ByteRow>(
    `select a.id as asset_id, a.title,
            f.r2_key as original_key, f.byte_size,
            coalesce(ae.edited_medium_key, ap.r2_key) as medium_key,
            ap.byte_size as medium_size
       from assets a
       left join lateral (
         select r2_key, byte_size from files
          where asset_id = a.id
          order by (r2_key is null), created_at
          limit 1
       ) f on true
       left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
       left join asset_edits ae on ae.asset_id = a.id
      where a.id = any($1)`,
    [assetIds],
  );

  // Preserve the page order the caller asked for.
  const byId = new Map(byteRes.rows.map((r) => [r.asset_id, r]));
  const ordered = rows.map((r) => byId.get(r.asset_id)).filter((r): r is ByteRow => Boolean(r));

  const plan = planZip(ordered, options.zipContents);
  if (plan.entries.length === 0) throw new Error("export_empty");
  if (plan.totalBytes > ZIP_MAX_TOTAL_BYTES) {
    const gb = (plan.totalBytes / 1024 ** 3).toFixed(1);
    throw new Error(`export_too_large:${gb}GB`);
  }

  const files: ZipEntry[] = [];
  for (const [i, entry] of plan.entries.entries()) {
    try {
      files.push({ name: entry.name, body: await getObjectBuffer(entry.key) });
    } catch (err) {
      // One unreadable object must not lose the other 499.
      console.log(`[export] ${entry.name}: ${entry.key} unreadable — ${String(err)}`);
      plan.missing.push(entry.name);
    }
    await onProgress(i + 1, plan.entries.length);
  }

  files.push({ name: "captions.csv", body: await renderCaptionsCsv(pool, rows, options) });
  const readme = buildReadme(plan, options.zipContents);
  if (readme) files.push({ name: "README.txt", body: Buffer.from(readme, "utf8") });

  return { body: buildZip(files), skipped: plan.missing.length };
}
