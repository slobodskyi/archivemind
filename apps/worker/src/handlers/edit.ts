import { editJobPayloadSchema } from "@archivemind/shared";
import { getObjectBuffer, putObject } from "../services/r2";
import { editPreviewKey, renderEditedPreviews } from "../services/edit-render";
import type { HandlerContext } from "./index";

/** Image edit (ADR 0030), single asset: render fresh edited previews from the
 *  asset's ORIGINAL medium preview and store them under asset_edits' own R2
 *  keys + recipe. Non-destructive: asset_previews (the originals) are untouched,
 *  so a reset is just dropping the asset_edits row. Source-agnostic — gdrive
 *  needs no original bytes here, only the medium preview R2 already holds. */
export async function editHandler({ pool, job, progress }: HandlerContext): Promise<void> {
  const { asset_id, recipe } = editJobPayloadSchema.parse(job.payload);
  await progress(5, "Preparing edit", 0, 1);

  const { rows } = await pool.query<{ workspace_id: string; medium_key: string | null }>(
    `select a.workspace_id, ap.r2_key as medium_key
       from assets a
       left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
      where a.id = $1 and a.status = 'active'`,
    [asset_id],
  );
  const row = rows[0];
  if (!row) {
    await progress(100, "Asset not found", 1, 1);
    return;
  }
  if (!row.medium_key) throw new Error("edit_no_preview"); // message IS the code -> ai_jobs.error

  const src = await getObjectBuffer(row.medium_key);
  await progress(45, "Rendering edit", 0, 1);
  const previews = await renderEditedPreviews(src, recipe);

  let thumbKey: string | null = null;
  let mediumKey: string | null = null;
  for (const p of previews) {
    const key = editPreviewKey(row.workspace_id, asset_id, p.size);
    await putObject(key, p.data, "image/webp");
    if (p.size === "thumb") thumbKey = key;
    else if (p.size === "medium") mediumKey = key;
  }

  await pool.query(
    `insert into asset_edits (asset_id, recipe, edited_thumb_key, edited_medium_key)
       values ($1, $2, $3, $4)
     on conflict (asset_id) do update set
       recipe = excluded.recipe,
       edited_thumb_key = excluded.edited_thumb_key,
       edited_medium_key = excluded.edited_medium_key,
       updated_at = now()`,
    [asset_id, JSON.stringify(recipe), thumbKey, mediumKey],
  );
  await pool.query(`update assets set updated_at = now() where id = $1`, [asset_id]);
  await progress(100, "Edited", 1, 1);
}
