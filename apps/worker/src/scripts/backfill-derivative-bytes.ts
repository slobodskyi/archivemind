import { createPool } from "../db";
import { headObjectSize } from "../services/r2";

/** One-shot backfill for migration 20260727000002.
 *
 *  `asset_previews.byte_size` and `asset_edits.thumb_bytes/medium_bytes` are
 *  written at upload time from here on, but every row created before that
 *  migration has no size — and the Usage page refuses to guess, so those files
 *  simply don't appear in the storage total until this runs. The only way to
 *  recover the number is to ask R2, one HeadObject per key.
 *
 *  Safe to re-run and safe to interrupt: it only ever touches rows whose size
 *  is still null, in batches, so a second run resumes where the first stopped.
 *  A key that no longer exists in R2 records 0 rather than staying null —
 *  "we checked, and we are holding nothing" is a measurement, and leaving it
 *  null would make the page report an unmeasured file forever.
 *
 *  Run it against whichever database you mean, explicitly:
 *
 *    DATABASE_URL=… node node_modules/tsx/dist/cli.mjs \
 *      src/scripts/backfill-derivative-bytes.ts
 *
 *  R2_* credentials come from the same env the worker uses.
 */

const BATCH = 200;

async function main(): Promise<void> {
  const pool = createPool();
  let previews = 0;
  let edits = 0;
  let missing = 0;

  try {
    // ── previews ────────────────────────────────────────────────────
    for (;;) {
      const { rows } = await pool.query<{ asset_id: string; size: string; r2_key: string }>(
        `select asset_id, size, r2_key from asset_previews
          where byte_size is null limit $1`,
        [BATCH],
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        const bytes = await headObjectSize(row.r2_key);
        if (bytes == null) missing += 1;
        await pool.query(
          `update asset_previews set byte_size = $3 where asset_id = $1 and size = $2`,
          [row.asset_id, row.size, bytes ?? 0],
        );
        previews += 1;
      }
      console.log(`[backfill] previews: ${previews} measured (${missing} keys gone)`);
    }

    // ── edited previews ─────────────────────────────────────────────
    for (;;) {
      const { rows } = await pool.query<{
        asset_id: string;
        edited_thumb_key: string | null;
        edited_medium_key: string | null;
      }>(
        `select asset_id, edited_thumb_key, edited_medium_key from asset_edits
          where (thumb_bytes is null and edited_thumb_key is not null)
             or (medium_bytes is null and edited_medium_key is not null)
          limit $1`,
        [BATCH],
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        const thumb = row.edited_thumb_key ? await headObjectSize(row.edited_thumb_key) : null;
        const medium = row.edited_medium_key ? await headObjectSize(row.edited_medium_key) : null;
        if (row.edited_thumb_key && thumb == null) missing += 1;
        if (row.edited_medium_key && medium == null) missing += 1;
        await pool.query(
          `update asset_edits
              set thumb_bytes  = coalesce(thumb_bytes,  $2),
                  medium_bytes = coalesce(medium_bytes, $3)
            where asset_id = $1`,
          [
            row.asset_id,
            row.edited_thumb_key ? (thumb ?? 0) : null,
            row.edited_medium_key ? (medium ?? 0) : null,
          ],
        );
        edits += 1;
      }
      console.log(`[backfill] edits: ${edits} measured`);
    }

    console.log(`[backfill] done — ${previews} preview(s), ${edits} edit row(s), ${missing} key(s) gone from R2`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exitCode = 1;
});
