import sharp from "sharp";

/** Previews per spec §6/§8.1: thumb 256 / medium 1024 on the long edge, webp,
 *  plus `large` 2048 since ADR 0055 — the fullscreen viewer's sharp step for
 *  every file whose original a browser cannot be handed (Drive, OneDrive, RAW,
 *  TIFF, HEIC outside WebKit, an edit). `.rotate()` bakes in EXIF orientation
 *  so previews always display upright. */

export const PREVIEW_SIZES = [
  { size: "thumb", edge: 256 },
  { size: "medium", edge: 1024 },
  { size: "large", edge: 2048 },
] as const;

export type PreviewSize = (typeof PREVIEW_SIZES)[number]["size"];

const MEDIUM_EDGE = 1024;

/** The sizes a picture of these dimensions gets. `large` only when the source
 *  is BIGGER than medium: below that, `withoutEnlargement` would write a
 *  second copy of medium's pixels under another name. thumb and medium are
 *  always written (they are what every view reads), however small the source.
 *  Orientation does not matter — only the long edge is compared. */
export function previewSizesFor(width: number | undefined, height: number | undefined): PreviewSize[] {
  const long = Math.max(width ?? 0, height ?? 0);
  return PREVIEW_SIZES.filter((s) => s.size !== "large" || long > MEDIUM_EDGE).map((s) => s.size);
}

export type PreviewInput =
  | { kind: "encoded"; data: Buffer }
  | { kind: "raw"; data: Buffer; width: number; height: number };

export interface GeneratedPreview {
  size: PreviewSize;
  data: Buffer;
  width: number;
  height: number;
}

/** Every size the source earns (`previewSizesFor`), or only those of them in
 *  `only` — the large backfill asks for `["large"]` and must not rewrite the
 *  thumb and medium every view is already showing. */
export async function makePreviews(input: PreviewInput, only?: readonly PreviewSize[]): Promise<GeneratedPreview[]> {
  const base =
    input.kind === "raw"
      ? sharp(input.data, { raw: { width: input.width, height: input.height, channels: 4 } })
      : sharp(input.data);
  const dims = input.kind === "raw" ? input : await base.metadata();
  const earned = previewSizesFor(dims.width, dims.height);

  const out: GeneratedPreview[] = [];
  for (const { size, edge } of PREVIEW_SIZES) {
    if (!earned.includes(size) || (only && !only.includes(size))) continue;
    const { data, info } = await base
      .clone()
      .rotate()
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    out.push({ size, data, width: info.width, height: info.height });
  }
  return out;
}

export function previewKey(workspaceId: string, assetId: string, size: string): string {
  return `${workspaceId}/previews/${assetId}/${size}.webp`;
}
