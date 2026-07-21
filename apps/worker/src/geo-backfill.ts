import type pg from "pg";
import { reverseGeocode } from "./services/geocode";

/** Fills `asset_exif.gps_label` for assets ingested before reverse geocoding
 *  existed (ADR 0026). Coordinates have been stored since day one, so this
 *  reads nothing back from R2 — it is a pure re-derivation over rows we
 *  already have. Scheduled from index.ts next to the retention sweeper.
 *
 *  A row is "done" once `gps_label` is non-null, including the empty string,
 *  which records "we looked and there is no settlement within range". Without
 *  that sentinel every wilderness shot would be re-examined on every pass. To
 *  re-derive everything after a data refresh:
 *    update asset_exif set gps_label = null where gps_label = ''; */

const BATCH = 500;
/** A ceiling per pass so a huge archive can't monopolise the DB pool; the
 *  remainder is picked up by the next scheduled run. */
const MAX_PER_RUN = 20_000;

interface ExifCoordRow {
  asset_id: string;
  gps_lat: number | null;
  gps_lon: number | null;
}

export async function backfillGeoLabels(pool: pg.Pool): Promise<number> {
  let labelled = 0;
  for (let processed = 0; processed < MAX_PER_RUN; processed += BATCH) {
    const { rows } = await pool.query<ExifCoordRow>(
      `select asset_id, gps_lat, gps_lon
         from asset_exif
        where gps_label is null and gps_lat is not null
        limit $1`,
      [BATCH],
    );
    if (rows.length === 0) break;

    const ids: string[] = [];
    const labels: string[] = [];
    for (const row of rows) {
      const hit = reverseGeocode(row.gps_lat, row.gps_lon);
      ids.push(row.asset_id);
      labels.push(hit?.label ?? "");
      if (hit) labelled += 1;
    }
    await pool.query(
      `update asset_exif e
          set gps_label = v.label
         from (select * from unnest($1::uuid[], $2::text[]) as t(asset_id, label)) v
        where e.asset_id = v.asset_id::uuid`,
      [ids, labels],
    );
    // A short batch means the queue is drained; stop rather than spin.
    if (rows.length < BATCH) break;
  }
  return labelled;
}
