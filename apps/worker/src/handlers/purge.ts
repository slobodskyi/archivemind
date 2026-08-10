import { purgeJobPayloadSchema } from "@archivemind/shared";
import type pg from "pg";
import { deleteObject } from "../services/r2";
import type { HandlerContext } from "./index";

/** Purge (ADR 0033): erase an expired trashed asset's stored bytes and DB
 *  derivatives, keeping the assets row itself as a lightweight tombstone
 *  (dedup reactivation depends on the row existing — ADR 0032). Enqueued by
 *  sweep_deleted_assets() after the 30-day grace window, or immediately by
 *  POST /api/assets/purge ("Delete permanently" / "Empty trash").
 *
 *  Per asset, in this order — the order is the correctness argument:
 *  1. CLAIM: stamp purged_at iff still status='deleted'. A restore that raced
 *     the enqueue wins here (0 rows → skip); once claimed, the restore route's
 *     own `purged_at is null` guard blocks the reverse race.
 *  2. R2 objects, while the DB rows still map the keys (original, thumb/medium
 *     previews, edited previews). A failure THROWS → the job retries with the
 *     key mapping intact. S3 deletes are idempotent, so a retry after a
 *     partial pass is safe.
 *  3. Export ARTIFACTS containing the asset — a PDF embeds a JPEG of it, a ZIP
 *     embeds the file, so erasing the asset's own bytes and leaving those is not
 *     erasure. Contained rather than throwing (see the call site).
 *  4. Derivative rows (including the human Topic override), then files.r2_key
 *     + content_hash — clearing the hash releases the dedup claim
 *     (files_dedup_idx), so re-importing the same bytes later ingests cleanly
 *     as a fresh asset instead of merging into an empty tombstone.
 *
 *  Contained per-asset like ingest (#116): one asset's failure must not
 *  abandon the rest; a run where EVERY asset failed fails the job (#119). */

export async function purgeHandler({ pool, job, progress }: HandlerContext): Promise<void> {
  const { asset_ids } = purgeJobPayloadSchema.parse(job.payload);

  let done = 0;
  let failed = 0;
  let skipped = 0;

  for (const assetId of asset_ids) {
    await progress(
      Math.round((done / asset_ids.length) * 100),
      `Purging ${done + 1} of ${asset_ids.length}`,
      done,
      asset_ids.length,
    );
    try {
      const outcome = await purgeAsset(pool, assetId);
      if (outcome === "skipped") skipped += 1;
    } catch (err) {
      console.log(`[purge] ${assetId}: purge_failed — ${String(err)}`);
      failed += 1;
    }
    done += 1;
  }

  const tail = [
    failed > 0 ? `${failed} failed` : null,
    skipped > 0 ? `${skipped} skipped` : null,
  ]
    .filter(Boolean)
    .join(", ");
  await progress(100, `Purged ${done} file(s)${tail ? ` (${tail})` : ""}`, done, asset_ids.length);

  // #119 posture: nothing at all got through → a FAILED job (retry may heal a
  // transient R2 outage), never a silent 'done'. Skipped (restored) rows count
  // as handled — they are the race resolving correctly, not an error.
  if (asset_ids.length > 0 && failed === asset_ids.length) {
    throw new Error("purge_all_failed");
  }
}

async function purgeAsset(pool: pg.Pool, assetId: string): Promise<"purged" | "skipped"> {
  // Claim. rowCount 0 means either the user restored it (skip — their click
  // wins) or a previous attempt already claimed it and crashed mid-cleanup
  // (finish the job: the steps below are all idempotent).
  const claim = await pool.query(
    `update assets set purged_at = now()
      where id = $1 and status = 'deleted' and purged_at is null`,
    [assetId],
  );
  if (claim.rowCount === 0) {
    const { rows } = await pool.query<{ status: string; purged_at: string | null }>(
      `select status, purged_at from assets where id = $1`,
      [assetId],
    );
    const row = rows[0];
    if (!row || row.status !== "deleted" || row.purged_at == null) return "skipped";
  }

  // Collect every R2 key BEFORE any row is deleted — cascades sever the
  // DB→R2 mapping, and an unmapped object is an unreclaimable orphan.
  const keys: string[] = [];
  const { rows: files } = await pool.query<{ r2_key: string }>(
    `select r2_key from files where asset_id = $1 and r2_key is not null`,
    [assetId],
  );
  keys.push(...files.map((f) => f.r2_key));
  const { rows: previews } = await pool.query<{ r2_key: string }>(
    `select r2_key from asset_previews where asset_id = $1`,
    [assetId],
  );
  keys.push(...previews.map((p) => p.r2_key));
  const { rows: edits } = await pool.query<{
    edited_thumb_key: string | null;
    edited_medium_key: string | null;
  }>(`select edited_thumb_key, edited_medium_key from asset_edits where asset_id = $1`, [assetId]);
  for (const e of edits) {
    if (e.edited_thumb_key) keys.push(e.edited_thumb_key);
    if (e.edited_medium_key) keys.push(e.edited_medium_key);
  }

  // R2 first; a throw here leaves every row in place for the retry.
  for (const key of keys) {
    await deleteObject(key);
  }

  // Derived DELIVERABLES carry a copy of the pixels too — an exported PDF embeds
  // a JPEG of the medium preview, a ZIP embeds the file itself — so erasing the
  // asset's own bytes while leaving those behind is not erasure.
  //
  // Contained deliberately: `sweepExpiredExports` deletes every artifact within
  // EXPORT_RETENTION_DAYS regardless, so it is the backstop. Throwing here would
  // be worse than the risk it guards — the asset's own bytes are already gone by
  // this point, so a persistently failing artifact (a malformed key, say) would
  // block the row cleanup below forever, leaving the tombstone holding its dedup
  // claim and its derivative rows for good.
  try {
    const erased = await purgeExportArtifacts(pool, assetId);
    if (erased > 0) console.log(`[purge] ${assetId}: erased ${erased} export artifact(s)`);
  } catch (err) {
    console.log(`[purge] ${assetId}: export cleanup failed, sweep will retry — ${String(err)}`);
  }

  // Rows second. Sequential single-row-scope deletes; each is idempotent.
  await pool.query(`delete from asset_previews where asset_id = $1`, [assetId]);
  await pool.query(`delete from asset_edits where asset_id = $1`, [assetId]);
  await pool.query(`delete from asset_tags where asset_id = $1`, [assetId]);
  await pool.query(`delete from captions where asset_id = $1`, [assetId]);
  await pool.query(`delete from facts where asset_id = $1`, [assetId]);
  await pool.query(`delete from embeddings where asset_id = $1`, [assetId]);
  await pool.query(`delete from asset_exif where asset_id = $1`, [assetId]);
  // Soft trash keeps curation so Restore is lossless. Permanent purge is the
  // boundary where it must go: the asset row survives only as a dedup
  // tombstone, so its ON DELETE CASCADE will never fire on its own. Leaving the
  // override would keep a generated destination protected forever and inflate
  // a manual topic's live size with an asset that can no longer render.
  await pool.query(`delete from topic_cluster_overrides where asset_id = $1`, [assetId]);
  // The files row survives (provenance: origin/source_file_id/title live on),
  // but holds no bytes and no dedup claim from here on.
  await pool.query(`update files set r2_key = null, content_hash = null where asset_id = $1`, [
    assetId,
  ]);
  // No embedding → no cluster membership; ai_processed_at cleared so a future
  // revival reads as "not yet analyzed" instead of pretending its AI is intact.
  await pool.query(`update assets set cluster_id = null, ai_processed_at = null where id = $1`, [
    assetId,
  ]);
  return "purged";
}

/** Delete every export artifact that contains this asset, and clear its key so
 *  GET /api/exports stops offering a download for bytes that are gone.
 *
 *  Matching is on `payload.exported_asset_ids` — the set the export job actually
 *  rendered, written back by finishExport. The request payload alone is not
 *  enough: a `group_id` export carries no asset list, and group membership can
 *  change after the render. `payload.asset_ids` is still checked so artifacts
 *  produced before that field existed are covered; it is the REQUESTED set, a
 *  superset of the rendered one, which is the safe direction here — the user has
 *  just permanently deleted this photo, so erring toward removing a deliverable
 *  that may contain it is the intent, not a loss.
 *
 *  Workspace-scoped as a belt: an asset id is unique, but a pathological payload
 *  must not be able to reach another workspace's artifact. */
export async function purgeExportArtifacts(pool: pg.Pool, assetId: string): Promise<number> {
  const { rows } = await pool.query<{ id: string; result_key: string | null }>(
    `select id, payload->>'result_key' as result_key
       from ai_jobs
      where type = 'export'
        and payload ? 'result_key'
        and workspace_id = (select workspace_id from assets where id = $1)
        and (payload->'exported_asset_ids' @> to_jsonb($1::text)
             or payload->'asset_ids' @> to_jsonb($1::text))`,
    [assetId],
  );

  let erased = 0;
  for (const row of rows) {
    if (!row.result_key) continue;
    await deleteObject(row.result_key); // idempotent
    await pool.query(`update ai_jobs set payload = payload - 'result_key' where id = $1`, [row.id]);
    erased += 1;
  }
  return erased;
}
