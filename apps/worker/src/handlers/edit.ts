import { editJobPayloadSchema, editRecipeSchema, type EditRecipe } from "@archivemind/shared";
import { deleteObject, getObjectBuffer, putObject } from "../services/r2";
import { editPreviewKey, renderEditedPreviews } from "../services/edit-render";
import type { HandlerContext } from "./index";

interface SourceRow {
  workspace_id: string;
  medium_key: string | null;
  large_key: string | null;
  stored_recipe: unknown;
  stored_large_key: string | null;
}

/** Image edit (ADR 0030), single asset: render fresh edited previews from the
 *  asset's best UNEDITED preview — the 2048 px `large` when it has one, else
 *  medium (ADR 0055) — and store them under asset_edits' own R2 keys + recipe.
 *  Non-destructive: asset_previews (the originals) are untouched, so a reset is
 *  just dropping the asset_edits row. Source-agnostic — gdrive needs no
 *  original bytes here, only the previews R2 already holds.
 *
 *  A payload with no recipe is a RE-RENDER of the stored edit (the large
 *  backfill's, once an edited photo gains its large preview). It only ever
 *  updates the row it read: if the edit was reset or replaced meanwhile, what
 *  it rendered is thrown away instead of resurrecting the old recipe. */
export async function editHandler({ pool, job, progress }: HandlerContext): Promise<void> {
  const payload = editJobPayloadSchema.parse(job.payload);
  const { asset_id } = payload;
  await progress(5, "Preparing edit", 0, 1);

  const { rows } = await pool.query<SourceRow>(
    `select a.workspace_id, med.r2_key as medium_key, lg.r2_key as large_key,
            ae.recipe as stored_recipe, ae.edited_large_key as stored_large_key
       from assets a
       left join asset_previews med on med.asset_id = a.id and med.size = 'medium'
       left join asset_previews lg on lg.asset_id = a.id and lg.size = 'large'
       left join asset_edits ae on ae.asset_id = a.id
      where a.id = $1 and a.status = 'active'`,
    [asset_id],
  );
  const row = rows[0];
  if (!row) {
    await progress(100, "Asset not found", 1, 1);
    return;
  }
  const rerender = payload.recipe === undefined;
  let recipe: EditRecipe;
  if (payload.recipe !== undefined) {
    recipe = payload.recipe;
  } else {
    const stored = editRecipeSchema.safeParse(row.stored_recipe);
    if (!stored.success) {
      await progress(100, "No edit to re-render", 1, 1);
      return;
    }
    recipe = stored.data;
  }
  const srcKey = row.large_key ?? row.medium_key;
  if (!srcKey) throw new Error("edit_no_preview"); // message IS the code -> ai_jobs.error

  const src = await getObjectBuffer(srcKey);
  await progress(45, "Rendering edit", 0, 1);
  const previews = await renderEditedPreviews(src, recipe);

  const keys: Record<"thumb" | "medium" | "large", string | null> = { thumb: null, medium: null, large: null };
  // Edited previews are a third copy of the image in R2 (original + previews +
  // these), and until migration 20260727000002 nothing recorded their size —
  // so an archive where every photo was cropped under-reported its own storage
  // by a whole tier. Measured here, where the buffer is already in hand.
  const bytes: Record<"thumb" | "medium" | "large", number | null> = { thumb: null, medium: null, large: null };
  for (const p of previews) {
    const key = editPreviewKey(row.workspace_id, asset_id, p.size);
    await putObject(key, p.data, "image/webp");
    keys[p.size] = key;
    bytes[p.size] = p.data.length;
  }
  // A re-render matches the row on the recipe exactly AS STORED, not as zod
  // re-serialises it (a default it fills in, or a key it strips, would make
  // every older edit look "changed" and never re-render).
  const recipeJson = JSON.stringify(rerender ? row.stored_recipe : recipe);
  const values = [asset_id, recipeJson, keys.thumb, keys.medium, bytes.thumb, bytes.medium, keys.large, bytes.large];

  if (rerender) {
    const updated = await pool.query(
      `update asset_edits set
         edited_thumb_key = $3, edited_medium_key = $4, thumb_bytes = $5, medium_bytes = $6,
         edited_large_key = $7, large_bytes = $8, updated_at = now()
       where asset_id = $1 and recipe = $2::jsonb`,
      values,
    );
    if (updated.rowCount === 0) {
      // Reset (or replaced) while this ran: the reset route already removed
      // the renders it knew about, so the ones just written are orphans.
      await Promise.all(Object.values(keys).flatMap((k) => (k ? [deleteObject(k)] : [])));
      await progress(100, "Edit changed meanwhile — nothing to re-render", 1, 1);
      return;
    }
  } else {
    await pool.query(
      `insert into asset_edits (asset_id, recipe, edited_thumb_key, edited_medium_key,
                                thumb_bytes, medium_bytes, edited_large_key, large_bytes)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (asset_id) do update set
         recipe = excluded.recipe,
         edited_thumb_key = excluded.edited_thumb_key,
         edited_medium_key = excluded.edited_medium_key,
         thumb_bytes = excluded.thumb_bytes,
         medium_bytes = excluded.medium_bytes,
         edited_large_key = excluded.edited_large_key,
         large_bytes = excluded.large_bytes,
         updated_at = now()`,
      values,
    );
  }
  // A tighter crop can stop earning a large render the previous edit had: its
  // object would otherwise sit in R2 counted by nobody. Best-effort — the
  // row no longer points at it, so a failure here leaks bytes, not a picture.
  if (row.stored_large_key && !keys.large) {
    await deleteObject(row.stored_large_key).catch((err: unknown) =>
      console.error(`[edit] stale large render cleanup failed for ${asset_id}:`, err),
    );
  }
  await pool.query(`update assets set updated_at = now() where id = $1`, [asset_id]);
  await progress(100, "Edited", 1, 1);
}
