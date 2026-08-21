import { EXPORT_RETENTION_DAYS } from "@archivemind/shared";
import type pg from "pg";
import { deleteObject } from "./services/r2";

const PUBLICATION_PREPARING_ABANDON_HOURS = 24;

/** Retention sweeps — periodic maintenance that isn't queue work, so it lives
 *  here rather than in queue.ts. Scheduled from index.ts alongside the reaper. */

/** Hard-delete trashed projects past their grace period (migration
 *  20260714000001). The window lives in the SQL function's default so there is
 *  one source of truth; assets are workspace-global and survive. Returns the
 *  number of projects removed. */
export async function sweepTrashedProjects(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ removed: number }>(
    "select sweep_trashed_projects() as removed",
  );
  return rows[0]?.removed ?? 0;
}

/** Hard-delete trashed WORKSPACES past their grace period (migration
 *  20260813000001, ADR 0044). Same shape and same 30-day default as the project
 *  sweep, and like it this never touches R2: a workspace is a curated subset of
 *  a project's files. Only here do the FK side-effects run — membership rows
 *  cascade and the notes and folders made inside fall back to the project canvas
 *  with board_id null. Returns the number of workspaces removed. */
export async function sweepTrashedBoards(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ removed: number }>(
    "select sweep_trashed_boards() as removed",
  );
  return rows[0]?.removed ?? 0;
}

/** Hard-delete trashed CONTENT DRAFTS past their grace period (migration
 *  20260821000001, ADR 0049). Drafts have had a soft delete since 20260814000001
 *  and no sweep to go with it, so a deleted draft was kept forever and listed
 *  nowhere; now that the Trash lists them, the 30 days has to be real. Published
 *  /p/{token} links are untouched — they carry their own snapshot and reference
 *  the draft by plain text, deliberately not by foreign key (ADR 0046). Returns
 *  the number of drafts removed. */
export async function sweepTrashedDrafts(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ removed: number }>(
    "select sweep_trashed_drafts() as removed",
  );
  return rows[0]?.removed ?? 0;
}

/** Enqueue 'purge' jobs for trashed ASSETS past their grace period (migration
 *  20260723000001, ADR 0033). Same shape as the project sweep — the 30-day
 *  window lives in the SQL default — but this one only enqueues: the purge
 *  handler does the R2 + derivative erasure so the sweep stays a fast DB call.
 *  Returns the number of assets enqueued. */
export async function sweepDeletedAssets(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ enqueued: number }>(
    "select sweep_deleted_assets() as enqueued",
  );
  return rows[0]?.enqueued ?? 0;
}

/** Delete the R2 objects behind expired exports (ADR 0035 Amendments).
 *
 *  Nothing used to remove these, ever: the two sweeps above touch R2 not at all,
 *  purge.ts collects keys only from files/asset_previews/asset_edits, and there
 *  is no bucket lifecycle rule in the repo. Because the key derives from the JOB
 *  id, every re-export of the same artboard minted another object — so ten
 *  iterations left ten PDFs, all unreachable once the job id was forgotten.
 *  TECH_SPEC §8.5 said "(presigned GET, cleanup later)"; this is later.
 *
 *  The `ai_jobs` row survives as the record of the export; only the artifact and
 *  its key go, so `GET /api/exports` stops offering a download for bytes that no
 *  longer exist. Deletes run one at a time and clear the key individually: a
 *  failure mid-way leaves the rest for the next sweep rather than orphaning the
 *  objects whose keys it had already dropped. */
export async function sweepExpiredExports(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ id: string; result_key: string }>(
    `select id, payload->>'result_key' as result_key
       from ai_jobs
      where type = 'export'
        and payload ? 'result_key'
        and coalesce(finished_at, created_at) < now() - ($1 || ' days')::interval
      limit 500`,
    [String(EXPORT_RETENTION_DAYS)],
  );

  let removed = 0;
  for (const row of rows) {
    if (!row.result_key) continue;
    await deleteObject(row.result_key); // idempotent: deleting a missing key succeeds
    await pool.query(`update ai_jobs set payload = payload - 'result_key' where id = $1`, [row.id]);
    removed += 1;
  }
  return removed;
}

type PublicationPreviewRow = {
  share_id: string;
  workspace_id: string;
  public_id: string;
  preview_r2_key: string;
};

/** Remove share-owned publication previews that no public capability may use.
 *
 * A publication's parent row and token digest deliberately survive forever:
 * an old bearer token must never become valid again. Cleanup completion is
 * represented by deleting its private `publication_share_assets` rows only
 * after every copied preview was deleted successfully. Original/download and
 * source-preview keys are never selected here.
 *
 * Asset Trash/purge revokes affected shares in a DB trigger (ADR 0046), so the
 * same pass also closes the copied-pixel erasure gap without coupling purge jobs
 * to publication storage. `preparing` versions get a 24-hour crash/retry window;
 * after that they are terminally revoked before cleanup. */
export async function sweepPublicationShares(pool: pg.Pool): Promise<number> {
  // Bound by SHARES, not asset rows. A publication may hold up to 20 previews;
  // cutting a share's rows at the batch edge and then dropping its mapping
  // would orphan the unseen objects.
  const { rows } = await pool.query<PublicationPreviewRow>(
    `with candidates as (
       select ps.id, ps.workspace_id
         from publication_shares ps
        where exists (
                select 1 from publication_share_assets psa where psa.share_id = ps.id
              )
          and (
            ps.status = 'revoked'
            or (ps.status = 'ready' and ps.expires_at is not null and ps.expires_at <= now())
            or (ps.status = 'preparing'
                and ps.created_at <= now() - make_interval(hours => $1::int))
          )
        order by coalesce(ps.revoked_at, ps.expires_at, ps.created_at), ps.id
        limit 100
     )
     select c.id as share_id,
            c.workspace_id::text as workspace_id,
            psa.public_id::text as public_id,
            psa.preview_r2_key
       from candidates c
       join publication_share_assets psa on psa.share_id = c.id
      order by c.id, psa.position`,
    [PUBLICATION_PREPARING_ABANDON_HOURS],
  );

  const shares = new Map<
    string,
    { workspaceId: string; previews: { publicId: string; key: string }[] }
  >();
  for (const row of rows) {
    const share = shares.get(row.share_id) ?? { workspaceId: row.workspace_id, previews: [] };
    share.previews.push({ publicId: row.public_id, key: row.preview_r2_key });
    shares.set(row.share_id, share);
  }

  let cleaned = 0;
  for (const [shareId, share] of shares) {
    try {
      // Re-check under the UPDATE lock. An activation that raced the candidate
      // SELECT wins if it made a still-live share ready first; otherwise this
      // transition fails closed before any bytes or mappings disappear.
      const claimed = await pool.query<{ workspace_id: string }>(
        `update publication_shares
            set status = 'revoked',
                ready_at = null,
                revoked_at = coalesce(revoked_at, now())
          where id = $1
            and (
              status = 'revoked'
              or (status = 'ready' and expires_at is not null and expires_at <= now())
              or (status = 'preparing'
                  and created_at <= now() - make_interval(hours => $2::int))
            )
          returning workspace_id::text as workspace_id`,
        [shareId, PUBLICATION_PREPARING_ABANDON_HOURS],
      );
      const workspaceId = claimed.rows[0]?.workspace_id;
      if (!workspaceId) continue;

      // Exact contract validation is stronger than a prefix-only check: a
      // corrupted row must never make this maintenance loop touch originals,
      // edits, exports, or another share's objects. Keep its mapping so it can
      // be investigated/retried rather than turning it into an orphan.
      const invalid = share.previews.find(
        (preview) =>
          preview.key !==
          `${workspaceId}/shares/${shareId}/previews/${preview.publicId}.webp`,
      );
      if (invalid) {
        console.log(
          `[publication-retention] ${shareId}: invalid preview key; cleanup skipped`,
        );
        continue;
      }

      // R2 first, mapping second. DeleteObject is idempotent, so a partial pass
      // or a concurrent authenticated revoke is safe to retry next sweep.
      for (const preview of share.previews) await deleteObject(preview.key);
      await pool.query(`delete from publication_share_assets where share_id = $1`, [shareId]);
      cleaned += 1;
    } catch (err) {
      // One broken object must not strand every other tenant's cleanup. The
      // untouched child rows retain the complete retry plan for the next pass.
      console.log(`[publication-retention] ${shareId}: cleanup failed — ${String(err)}`);
    }
  }

  return cleaned;
}
