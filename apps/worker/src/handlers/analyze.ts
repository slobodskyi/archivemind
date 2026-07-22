import { analyzeJobPayloadSchema } from "@archivemind/shared";
import { analyzeImage, analyzeModel, embedImage, EMBEDDING_MODEL } from "../services/gemini";
import { getObjectBuffer } from "../services/r2";
import type { HandlerContext } from "./index";

/** Analyze (spec §8.2), per asset: medium preview → Gemini structured output
 *  (tags/description/OCR/facts) + image embedding (768) → upserts + one
 *  usage_event per call → ai_processed_at. Idempotent: tags/embeddings upsert
 *  by natural keys; unconfirmed AI facts are replaced. Sequential — the
 *  worker-level concurrency knob arrives with real volume. */

interface AnalyzeRow {
  asset_id: string;
  workspace_id: string;
  title: string | null;
  preview_key: string | null;
}

export async function analyzeHandler({ pool, job, progress }: HandlerContext): Promise<void> {
  const { asset_ids } = analyzeJobPayloadSchema.parse(job.payload);

  const { rows } = await pool.query<AnalyzeRow>(
    `select a.id as asset_id, a.workspace_id, a.title, ap.r2_key as preview_key
     from assets a
     left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
     where a.id = any($1::uuid[]) and a.status = 'active'
     order by a.created_at`,
    [asset_ids],
  );

  let done = 0;
  let analyzed = 0;
  for (const row of rows) {
    const label = row.title ?? row.asset_id;
    await progress(Math.round((done / rows.length) * 100), `Analyzing ${label}`, done, rows.length);

    if (!row.preview_key) {
      console.log(`[analyze] ${label}: no medium preview — skipped`);
      done += 1;
      continue;
    }

    const image = await getObjectBuffer(row.preview_key);
    const out = await analyzeImage(image, "image/webp");
    const embedding = await embedImage(image, "image/webp");

    for (const tag of out.tags) {
      const { rows: tagRows } = await pool.query(
        `insert into tags (workspace_id, name, category)
         values ($1, $2, $3)
         on conflict (workspace_id, name, category) do update set name = excluded.name
         returning id`,
        [row.workspace_id, tag.name.toLowerCase(), tag.category],
      );
      await pool.query(
        `insert into asset_tags (asset_id, tag_id, source, confidence)
         values ($1, $2, 'ai', $3)
         on conflict (asset_id, tag_id) do update set confidence = excluded.confidence`,
        [row.asset_id, tagRows[0].id, tag.confidence],
      );
    }

    // Replace unconfirmed machine facts so re-analyze never duplicates them.
    await pool.query(
      `delete from facts where asset_id = $1 and confirmed_by is null and source in ('ai','exif')`,
      [row.asset_id],
    );
    for (const fact of out.suggested_facts) {
      await pool.query(
        `insert into facts (asset_id, text, status, source) values ($1, $2, $3, $4)`,
        [
          row.asset_id,
          fact.text,
          fact.basis === "exif" ? "likely" : "needs_check",
          fact.basis === "exif" ? "exif" : "ai",
        ],
      );
    }

    await pool.query(
      `insert into embeddings (workspace_id, asset_id, kind, chunk_index, content, embedding)
       values ($1, $2, 'image', 0, $3, $4::vector)
       on conflict (asset_id, kind, chunk_index)
         do update set content = excluded.content, embedding = excluded.embedding`,
      [row.workspace_id, row.asset_id, out.description, JSON.stringify(embedding)],
    );

    await pool.query(
      `insert into usage_events (workspace_id, user_id, job_id, event_type, units, model)
       values ($1, $2, $3, 'image_analyzed', 1, $4), ($1, $2, $3, 'embedding', 1, $5)`,
      [row.workspace_id, job.user_id, job.id, analyzeModel(), EMBEDDING_MODEL],
    );

    await pool.query(`update assets set ai_processed_at = now() where id = $1`, [row.asset_id]);
    analyzed += 1;
    done += 1;
  }

  await progress(100, `Analyzed ${done} asset(s)`, done, rows.length);

  // Re-cluster the workspace's embeddings (ADR 0028). Deterministic, zero paid
  // calls — enqueued only when this run actually produced new embeddings, and
  // skipped if a cluster job is already queued (ai_jobs has no dedupe key, so
  // without this guard every analyze batch would pile one up). `done_items`
  // starts null so it never masks the workspace as "0/total" in the UI, which
  // never shows this job anyway (useWorkspace ignores non-active job ids).
  if (analyzed > 0) {
    await pool.query(
      `insert into ai_jobs (workspace_id, user_id, type, payload, total_items)
       select $1, $2, 'cluster', $3, 1
       where not exists (
         select 1 from ai_jobs
         where workspace_id = $1 and type = 'cluster' and status = 'queued')`,
      [job.workspace_id, job.user_id, JSON.stringify({ workspace_id: job.workspace_id })],
    );
  }
}
