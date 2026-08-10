import type pg from "pg";
import { clusterJobPayloadSchema } from "@archivemind/shared";
import { planClusters, type ClusterInput, type ExistingCluster } from "../services/cluster-logic";
import type { HandlerContext } from "./index";

/** Cluster (spec §10/§13, ADR 0028): re-cluster a workspace's analyzed assets
 *  by embedding similarity and store the result in topic_clusters +
 *  assets.cluster_id. Enqueued at the tail of analyze; makes ZERO Gemini calls
 *  (pure CPU over vectors analyze already stored), so it never violates the
 *  "AI only by button" rule. Deterministic — the same corpus yields the same
 *  clusters, and matched clusters keep their id/label across runs. */

interface EmbeddingRow {
  id: string;
  embedding: string; // pgvector text, e.g. "[0.1,0.2,...]" — JSON.parse-able
}

interface TagRow {
  asset_id: string;
  name: string;
  category: string;
}

interface ExistingRow {
  id: string;
  label: string;
  centroid: string;
  is_renamed: boolean;
  has_overrides: boolean;
}

export async function clusterHandler({ pool, job, progress }: HandlerContext): Promise<void> {
  const { workspace_id } = clusterJobPayloadSchema.parse(job.payload);

  await progress(5, "Loading embeddings");
  const { rows: embRows } = await pool.query<EmbeddingRow>(
    `select a.id, e.embedding::text as embedding
     from assets a
     join embeddings e on e.asset_id = a.id and e.kind = 'image' and e.chunk_index = 0
     where a.workspace_id = $1 and a.status = 'active'
     order by a.id`,
    [workspace_id],
  );

  const { rows: tagRows } = await pool.query<TagRow>(
    `select at.asset_id, t.name, t.category
     from asset_tags at
     join tags t on t.id = at.tag_id
     join assets a on a.id = at.asset_id
     where a.workspace_id = $1 and a.status = 'active'`,
    [workspace_id],
  );

  const tagsByAsset = new Map<string, { name: string; category: string }[]>();
  for (const t of tagRows) {
    (tagsByAsset.get(t.asset_id) ?? tagsByAsset.set(t.asset_id, []).get(t.asset_id)!).push({
      name: t.name,
      category: t.category,
    });
  }

  const inputs: ClusterInput[] = embRows.map((r) => ({
    assetId: r.id,
    embedding: JSON.parse(r.embedding) as number[],
    tags: tagsByAsset.get(r.id) ?? [],
  }));

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Serialize concurrent cluster runs for this workspace. A workspace-scoped
    // advisory lock, NOT `for update` on topic_clusters: `for update` locks only
    // rows that exist, so on a workspace's first run (or the first after the
    // n<8 delete-all branch below empties the table) two racing jobs would both
    // read zero clusters and both insert a full set — doubled/orphan clouds. The
    // advisory lock has no such gap; the second job blocks until the first
    // commits, then sees its clusters as `existing` and matches them out.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [workspace_id]);
    const { rows: existingRows } = await client.query<ExistingRow>(
      `select tc.id,
              tc.label,
              tc.is_renamed,
              tc.centroid::text as centroid,
              exists (
                select 1 from topic_cluster_overrides o where o.cluster_id = tc.id
              ) as has_overrides
         from topic_clusters tc
        where tc.workspace_id = $1
          and tc.origin = 'generated'
          and tc.centroid is not null`,
      [workspace_id],
    );

    const existing: ExistingCluster[] = existingRows.map((r) => ({
      id: r.id,
      label: r.label,
      centroid: JSON.parse(r.centroid) as number[],
      isRenamed: r.is_renamed,
      isProtected: r.has_overrides,
    }));

    const plan = planClusters(inputs, existing, workspace_id);

    if (plan === null) {
      // Below the clustering floor (corpus too small, or shrank below it): drop
      // the machine-named clusters so the read-time tag heuristic takes over
      // cleanly (FK sets each member's assets.cluster_id back to null).
      // User-renamed clusters are KEPT and emptied instead (ADR 0038), as are
      // generated clusters an override points at (ADR 0042) — wiping either
      // would violate curation (and the FK rejects it). With machine size 0 they still render
      // whenever effective override members point at them, and a later run can
      // match their centroid again.
      await client.query(
        `delete from topic_clusters tc
          where tc.workspace_id = $1
            and tc.origin = 'generated'
            and tc.is_renamed = false
            and not exists (
              select 1 from topic_cluster_overrides o where o.cluster_id = tc.id
            )`,
        [workspace_id],
      );
      await client.query(
        `update topic_clusters tc
            set size = 0
          where tc.workspace_id = $1
            and tc.origin = 'generated'
            and (
              tc.is_renamed = true
              or exists (
                select 1 from topic_cluster_overrides o where o.cluster_id = tc.id
              )
            )`,
        [workspace_id],
      );
      await client.query(`update assets set cluster_id = null where workspace_id = $1 and cluster_id is not null`, [
        workspace_id,
      ]);
      await client.query("commit");
      await progress(100, `Too few analyzed assets to cluster (${inputs.length})`);
      return;
    }

    await progress(60, "Writing clusters");

    // Inserts first so new rows exist before assets reference them.
    for (const c of plan.insert) {
      const { rows } = await client.query<{ id: string }>(
        `insert into topic_clusters (workspace_id, label, size, centroid, origin)
         values ($1, $2, $3, $4::vector, 'generated') returning id`,
        [workspace_id, c.label, c.size, JSON.stringify(c.centroid)],
      );
      await repoint(client, workspace_id, rows[0].id, c.assetIds);
    }

    for (const c of plan.update) {
      // `is_renamed` is re-checked HERE, in SQL, not just in planClusters: the
      // advisory lock above serializes cluster jobs against each other, but a
      // user's rename can land between this transaction's SELECT and this
      // UPDATE, and only the predicate closes that window (ADR 0038).
      await client.query(
        `update topic_clusters
            set centroid = $2::vector,
                size = $3,
                label = case when is_renamed then label else coalesce($4, label) end
          where id = $1 and origin = 'generated'`,
        [c.id, JSON.stringify(c.centroid), c.size, c.relabel],
      );
      await repoint(client, workspace_id, c.id, c.assetIds);
    }

    if (plan.deleteIds.length > 0) {
      // SQL repeats the override guard even though planClusters saw the
      // protected bit under the same advisory lock. It is cheap defence in
      // depth against a future caller that forgets to take that lock.
      await client.query(
        `delete from topic_clusters tc
          where tc.id = any($1::uuid[])
            and tc.origin = 'generated'
            and tc.is_renamed = false
            and not exists (
              select 1 from topic_cluster_overrides o where o.cluster_id = tc.id
            )`,
        [plan.deleteIds],
      );
    }

    // Renamed or override-referenced clusters that matched nothing this run:
    // kept, but emptied on the machine axis so curation survives (0038/0042).
    if (plan.retainIds.length > 0) {
      await client.query(
        `update topic_clusters set size = 0
          where id = any($1::uuid[]) and origin = 'generated'`,
        [plan.retainIds],
      );
    }

    await client.query("commit");
    const k = plan.insert.length + plan.update.length;
    await progress(100, `Clustered ${inputs.length} asset(s) into ${k} topic(s)`, inputs.length, inputs.length);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Point a batch of assets at a cluster. workspace_id is redundant (the ids
 *  came from a workspace-scoped query) but keeps the write self-guarding. */
async function repoint(
  client: pg.PoolClient,
  workspaceId: string,
  clusterId: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) return;
  await client.query(`update assets set cluster_id = $1 where workspace_id = $2 and id = any($3::uuid[])`, [
    clusterId,
    workspaceId,
    assetIds,
  ]);
}
