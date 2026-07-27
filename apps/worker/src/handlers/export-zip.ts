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
 *  The SQL below is executed against the real schema by
 *  supabase/tests/009_export_queries.sql — it selected a column on
 *  asset_previews that has never existed, and every ZIP export failed in
 *  production until that suite existed to catch it.
 *
 *  SIZE IS CHECKED BEFORE ANY BYTES ARE FETCHED, AND AGAIN AS THEY ARRIVE. `putObject` takes a Buffer and
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
  /** files.byte_size. Previews have no stored size — asset_previews holds only
   *  r2_key/width/height — so a preview entry's size is simply unknown here and
   *  the running total during the fetch is what enforces the budget for it. */
  byte_size: string | number | null;
  medium_key: string | null;
}

const num = (v: string | number | null): number =>
  v == null ? 0 : typeof v === "number" ? v : Number.parseInt(v, 10) || 0;

export interface ZipPlanEntry {
  assetId: string;
  key: string;
  name: string;
  /** Known size in bytes, or 0 when the row does not record one (previews). */
  bytes: number;
  /** True when this is a preview standing in for a missing original. */
  substituted: boolean;
}

export interface ZipPlan {
  entries: ZipPlanEntry[];
  /** Sum of the sizes we KNOW before fetching. Only originals contribute, so
   *  this is a lower bound — enough to refuse an obviously oversized bundle
   *  without spending a single R2 GET, never enough to prove one is safe. */
  knownBytes: number;
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
  let knownBytes = 0;

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
    const bytes = wantOriginal ? num(row.byte_size) : 0;
    entries.push({ assetId: row.asset_id, key, name, bytes, substituted });
    knownBytes += bytes;
  }

  return { entries, knownBytes, missing };
}

/** Refuse a bundle over the ceiling with a message the user can act on. */
export function assertUnderBudget(bytes: number): void {
  if (bytes > ZIP_MAX_TOTAL_BYTES) {
    throw new Error(`export_too_large:${(bytes / 1024 ** 3).toFixed(1)}GB`);
  }
}

/** The note shipped inside the archive: who made the work, and anything the
 *  bundle could not deliver as asked.
 *
 *  The rights block is the reason this file is now written even for a perfect
 *  bundle. A PDF carries the credit in its page footer and the copyright on its
 *  cover; a ZIP had nowhere to put either, so a client received a folder of
 *  photographs with no statement of who owns them or how they may be used —
 *  which for an editorial deliverable is the difference between a credited
 *  publication and an uncredited one. */
export function buildReadme(
  plan: ZipPlan,
  contents: ArtboardSettings["zipContents"],
  rights?: WorkspaceRights | null,
): string | null {
  const substituted = plan.entries.filter((e) => e.substituted);
  const rightsLines = rightsBlock(rights);
  if (substituted.length === 0 && plan.missing.length === 0 && rightsLines.length === 0) return null;

  const lines = ["ArchiveMind export", ""];
  lines.push(...rightsLines);
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

export interface WorkspaceRights {
  creator: string | null;
  credit: string | null;
  copyright_notice: string | null;
  usage_terms: string | null;
}

/** Labelled rights lines, omitting whatever the workspace has not set. Returns
 *  [] when nothing is set, so an archive with no byline gets no empty heading. */
function rightsBlock(rights: WorkspaceRights | null | undefined): string[] {
  const rows: [string, string | null | undefined][] = [
    ["Creator", rights?.creator],
    ["Credit", rights?.credit],
    ["Copyright", rights?.copyright_notice],
    ["Usage terms", rights?.usage_terms],
  ];
  const set = rows.filter(([, v]) => (v ?? "").trim().length > 0);
  if (set.length === 0) return [];
  return [...set.map(([label, v]) => `${label}: ${(v ?? "").trim()}`), ""];
}

export async function renderZip(
  pool: pg.Pool,
  rows: ExportRow[],
  options: ArtboardSettings,
  rights: WorkspaceRights | null,
  onProgress: (done: number, total: number) => Promise<void>,
): Promise<{ body: Buffer; skipped: number }> {
  const assetIds = rows.map((r) => r.asset_id);

  // One original per asset (the durable one if several files exist), plus the
  // medium preview as the fallback / the 'web' payload.
  const byteRes = await pool.query<ByteRow>(
    `select a.id as asset_id, a.title,
            f.r2_key as original_key, f.byte_size,
            coalesce(ae.edited_medium_key, ap.r2_key) as medium_key
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
  // Cheap refusal first: a RAW selection is over the limit before a single GET.
  assertUnderBudget(plan.knownBytes);

  const files: ZipEntry[] = [];
  let fetched = 0;
  for (const [i, entry] of plan.entries.entries()) {
    try {
      const body = await getObjectBuffer(entry.key);
      fetched += body.length;
      // Exact check as we go — previews record no size anywhere, so the
      // pre-flight sum above cannot see them. The whole archive is held in
      // memory (putObject takes a Buffer, no multipart exists), and an OOM here
      // is a SIGKILL: the handler's catch never runs, so failOrRetryJob never
      // fires and reapStaleJobs requeues the job every ~15 min forever.
      assertUnderBudget(fetched);
      files.push({ name: entry.name, body });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("export_too_large")) throw err;
      // One unreadable object must not lose the other 499.
      console.log(`[export] ${entry.name}: ${entry.key} unreadable — ${String(err)}`);
      plan.missing.push(entry.name);
    }
    await onProgress(i + 1, plan.entries.length);
  }

  files.push({ name: "captions.csv", body: await renderCaptionsCsv(pool, rows, options) });
  const readme = buildReadme(plan, options.zipContents, rights);
  if (readme) files.push({ name: "README.txt", body: Buffer.from(readme, "utf8") });

  return { body: buildZip(files), skipped: plan.missing.length };
}
