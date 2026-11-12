import type pg from "pg";
import { decodeBytes } from "./handlers/ingest";
import { makePreviews, previewKey } from "./services/previews";
import { deleteObject, getObjectBuffer, putObject } from "./services/r2";

/** Gives assets ingested before ADR 0055 their 2048 px `large` preview, a few
 *  hundred per pass, on the retention sweep's 6-hour cadence (scheduled from
 *  index.ts beside the geo backfill). Ingest writes `large` itself from now on,
 *  so this settles to a no-op once the archive has caught up.
 *
 *  It reads only originals WE hold — uploads and Dropbox files, the ones under
 *  `{workspace_id}/originals/`. A Google Drive or OneDrive original is never
 *  fetched here: that would spend a user's OAuth token on work they did not
 *  ask for, against their quota, possibly long after they stopped using the
 *  connection. Those files get `large` when they are imported anew.
 *
 *  Candidates are the photos whose stored medium is 1024 px on its long edge,
 *  i.e. whose original was at least that big; a smaller original already lives
 *  at full size in medium and never gets a `large` (`previewSizesFor`). Newest
 *  first — the photos people are opening now. An edited photo also gets its
 *  edit re-rendered from the new source, through an ordinary `edit` job that
 *  reads the recipe when it runs (so it can never reinstate an older edit). */

const DEFAULT_PER_RUN = 200;
/** Leave assets alone while their own ingest may still be writing previews. */
const MIN_AGE = "1 hour";

export interface LargeBackfillCandidate {
  asset_id: string;
  workspace_id: string;
  title: string | null;
  r2_key: string;
  mime_type: string | null;
  edited: boolean;
}

export interface LargeBackfillResult {
  written: number;
  /** Looked at and found nothing to write: the original is ≤ 1024 px after
   *  all (a medium of exactly 1024 reads the same as a downscaled one), it
   *  does not decode, or the asset left the archive while we worked. */
  skipped: number;
  failed: number;
  rerenders: number;
}

/** The oldest durable copy — the same file the ZIP export and the viewer's
 *  original route pick. */
export const LARGE_BACKFILL_CANDIDATES_SQL = `
  select a.id as asset_id, a.workspace_id, a.title, f.r2_key, f.mime_type,
         exists (select 1 from asset_edits ae where ae.asset_id = a.id) as edited
    from assets a
    join asset_previews med on med.asset_id = a.id and med.size = 'medium'
    join lateral (
      select fl.r2_key, fl.mime_type
        from files fl
       where fl.asset_id = a.id and fl.r2_key is not null
       order by fl.created_at asc
       limit 1
    ) f on true
   where a.status = 'active'
     and a.created_at < now() - interval '${MIN_AGE}'
     and greatest(med.width, med.height) >= 1024
     and starts_with(f.r2_key, a.workspace_id::text || '/originals/')
     and not exists (
       select 1 from asset_previews lg where lg.asset_id = a.id and lg.size = 'large')
     and a.id <> all($1::uuid[])
   order by a.created_at desc, a.id
   limit $2`;

/** Assets this process already tried and could not give a `large`. Kept in
 *  memory on purpose: the next boot retries each of them once — a few
 *  downloads per deploy — and nothing needs a table to remember a failure in.
 *  Without it, a pass would re-select the same unfixable assets every time and
 *  never reach the rest. */
const settled = new Set<string>();
let running = false;

/** LARGE_BACKFILL_PER_RUN overrides the batch size on Railway without a
 *  deploy; 0 switches the backfill off. */
export function largeBackfillPerRun(env: string | undefined): number {
  if (env === undefined || env.trim() === "") return DEFAULT_PER_RUN;
  const n = Number(env);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 5000) : DEFAULT_PER_RUN;
}

function keyName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

async function backfillOne(pool: pg.Pool, c: LargeBackfillCandidate): Promise<"written" | "skipped"> {
  const buf = await getObjectBuffer(c.r2_key);
  // The filename decides the RAW route, exactly as at ingest.
  const decoded = await decodeBytes(buf, c.mime_type, c.title ?? keyName(c.r2_key));
  if (!decoded.ok) return "skipped";
  const [large] = await makePreviews(decoded.input, ["large"]);
  if (!large) return "skipped";

  const key = previewKey(c.workspace_id, c.asset_id, "large");
  await putObject(key, large.data, "image/webp");
  // Written only while the asset is still active: one trashed meanwhile is
  // headed for purge, which must not find a preview it never knew about.
  const inserted = await pool.query(
    `insert into asset_previews (asset_id, size, r2_key, width, height, byte_size)
     select $1, 'large', $2, $3, $4, $5
      where exists (select 1 from assets where id = $1 and status = 'active')
     on conflict (asset_id, size) do update set
       r2_key = excluded.r2_key, width = excluded.width, height = excluded.height,
       byte_size = excluded.byte_size`,
    [c.asset_id, key, large.width, large.height, large.data.length],
  );
  if (inserted.rowCount === 0) {
    await deleteObject(key);
    return "skipped";
  }
  return "written";
}

export async function backfillLargePreviews(
  pool: pg.Pool,
  opts: { perRun?: number; shouldStop?: () => boolean; log?: (msg: string) => void } = {},
): Promise<LargeBackfillResult> {
  const result: LargeBackfillResult = { written: 0, skipped: 0, failed: 0, rerenders: 0 };
  const perRun = opts.perRun ?? largeBackfillPerRun(process.env.LARGE_BACKFILL_PER_RUN);
  // A pass of a few hundred originals takes minutes; the 6-hour timer firing
  // into a pass that is somehow still going must not start a second one.
  if (perRun === 0 || running) return result;
  running = true;
  try {
    const { rows } = await pool.query<LargeBackfillCandidate>(LARGE_BACKFILL_CANDIDATES_SQL, [
      [...settled],
      perRun,
    ]);
    // One at a time: this shares the process with the job loop, and a decoded
    // 48 MP original is ~200 MB of pixels.
    for (const c of rows) {
      if (opts.shouldStop?.()) break;
      try {
        const outcome = await backfillOne(pool, c);
        if (outcome === "skipped") {
          settled.add(c.asset_id);
          result.skipped += 1;
          continue;
        }
        result.written += 1;
        if (c.edited) {
          const queued = await pool.query(
            `insert into ai_jobs (workspace_id, user_id, type, payload, total_items, done_items)
             select $1, null, 'edit', $2, 1, 0
              where exists (select 1 from asset_edits where asset_id = $3)
                and not exists (
                  select 1 from ai_jobs
                   where workspace_id = $1 and type = 'edit'
                     and status in ('queued', 'running') and payload->>'asset_id' = $3::text)`,
            [c.workspace_id, JSON.stringify({ asset_id: c.asset_id }), c.asset_id],
          );
          result.rerenders += queued.rowCount ?? 0;
        }
      } catch (err) {
        settled.add(c.asset_id);
        result.failed += 1;
        opts.log?.(`large backfill: ${c.asset_id} failed — ${String(err)}`);
      }
    }
  } finally {
    running = false;
  }
  return result;
}

/** Tests only: forget what this process has settled. */
export function resetLargeBackfillForTests(): void {
  settled.clear();
  running = false;
}
