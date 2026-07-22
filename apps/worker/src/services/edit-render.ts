import sharp from "sharp";
import { inscribedCropForStraighten, resolveCropRect, type EditRecipe } from "@archivemind/shared";
import { PREVIEW_SIZES } from "./previews";

/** Tier-0 non-destructive render (ADR 0030). Applies the recipe to the asset's
 *  ORIGINAL medium preview (in R2 for every source) in the fixed order
 *  flip -> rotate90 -> straighten -> crop, then emits fresh thumb(256)/medium(1024)
 *  webp previews. asset_previews (the originals) are never touched; these land
 *  under asset_edits' own R2 keys. The quarter-turn and the straighten are one
 *  combined rotate() (sharp keeps only the last rotate() call). Sizes/quality
 *  reuse previews.ts so an edited preview can never drift from a fresh one. */

export interface RenderedEditPreview {
  size: (typeof PREVIEW_SIZES)[number]["size"];
  data: Buffer;
  width: number;
  height: number;
}

export async function renderEditedPreviews(src: Buffer, recipe: EditRecipe): Promise<RenderedEditPreview[]> {
  // No-empty-corners guarantee, server-side (defense in depth): a straighten
  // with no explicit crop auto-insets to the largest corner-free rectangle, so
  // a tilt never renders transparent triangles even if the client omitted it.
  let crop = recipe.crop;
  if (!crop && recipe.straighten !== 0) {
    const meta = await sharp(src).metadata();
    if (meta.width && meta.height) crop = inscribedCropForStraighten(meta.width, meta.height, recipe);
  }

  let pipe = sharp(src);
  if (recipe.flipH) pipe = pipe.flop();
  if (recipe.flipV) pipe = pipe.flip();
  const angle = (((recipe.rotate + recipe.straighten) % 360) + 360) % 360;
  if (angle !== 0) pipe = pipe.rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  // Resolve to a RAW buffer to read the WORKING dims sharp actually produced
  // WITHOUT a lossy re-encode: the source is already webp q82, so a webp
  // intermediate here would stack a second generational loss on every edit.
  // rotate-expansion rounding is sharp's own; resolveCropRect clamps to it.
  const worked = await pipe.raw().toBuffer({ resolveWithObject: true });
  const rect = resolveCropRect(worked.info.width, worked.info.height, crop);
  const cropped = sharp(worked.data, {
    raw: { width: worked.info.width, height: worked.info.height, channels: worked.info.channels },
  }).extract(rect);

  const out: RenderedEditPreview[] = [];
  for (const { size, edge } of PREVIEW_SIZES) {
    const { data, info } = await cropped
      .clone()
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }) // mirrors previews.ts makePreviews
      .toBuffer({ resolveWithObject: true });
    out.push({ size, data, width: info.width, height: info.height });
  }
  return out;
}

export function editPreviewKey(workspaceId: string, assetId: string, size: string): string {
  return `${workspaceId}/edits/${assetId}/${size}.webp`;
}
