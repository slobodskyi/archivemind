import sharp from "sharp";

/** Previews per spec §6/§8.1: thumb 256 / medium 1024 on the long edge, webp.
 *  `.rotate()` bakes in EXIF orientation so previews always display upright. */

export const PREVIEW_SIZES = [
  { size: "thumb", edge: 256 },
  { size: "medium", edge: 1024 },
] as const;

export type PreviewInput =
  | { kind: "encoded"; data: Buffer }
  | { kind: "raw"; data: Buffer; width: number; height: number };

export interface GeneratedPreview {
  size: (typeof PREVIEW_SIZES)[number]["size"];
  data: Buffer;
  width: number;
  height: number;
}

export async function makePreviews(input: PreviewInput): Promise<GeneratedPreview[]> {
  const base =
    input.kind === "raw"
      ? sharp(input.data, { raw: { width: input.width, height: input.height, channels: 4 } })
      : sharp(input.data);

  const out: GeneratedPreview[] = [];
  for (const { size, edge } of PREVIEW_SIZES) {
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
