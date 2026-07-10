import type { Photo } from "@/types";

/** Image source resolution for tiles/thumbs. Real assets must NEVER fall back
 *  to the mock picsum feed — a random stock photo where the user expects
 *  their own shot reads as data corruption. Before the worker has produced
 *  previews we show a neutral dark tile instead. */

type PhotoLike = Pick<Photo, "src" | "srcMedium" | "seed" | "source">;

// var(--bg-el) #171717 — a quiet "processing" tile.
export const PROCESSING_TILE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#171717"/></svg>',
  );

export function photoSrc(p: PhotoLike, w: number, h: number): string {
  if (p.src) return p.src;
  if (p.source === "upload") return PROCESSING_TILE;
  return `https://picsum.photos/seed/${p.seed}/${w}/${h}`;
}

export function photoSrcMedium(p: PhotoLike, w: number, h: number): string {
  if (p.srcMedium ?? p.src) return (p.srcMedium ?? p.src) as string;
  if (p.source === "upload") return PROCESSING_TILE;
  return `https://picsum.photos/seed/${p.seed}/${w}/${h}`;
}
