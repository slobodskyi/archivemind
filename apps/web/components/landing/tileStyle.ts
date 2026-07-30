/** Placeholder-tile look, shared by the hero Topic scene and the ScrubDemo.
 *
 *  The "dummy" photo squares are filled with fifteen free-licensed Unsplash
 *  photos (public/landing-photos, resized for the web), duplicated across the
 *  tiles so both previews read as a real camera-roll feed. Every tile still
 *  carries film grain (TILE_GRAIN) over the top. */

/** URLs of the fifteen photos, served from /public. */
export const PHOTOS = Array.from({ length: 15 }, (_, i) => `/landing-photos/p${i + 1}.jpg`);

/** CSS `background` value that covers a tile with photo `i` (wraps around). */
export function photoBg(i: number): string {
  return `center / cover url(${PHOTOS[i % PHOTOS.length]})`;
}

/** Fine grayscale film grain as an inline SVG (feTurbulence, desaturated) —
 *  self-contained, so it works under the artifact/CSP sandbox too. Applied as a
 *  low-opacity overlay-blended layer on every tile. */
export const TILE_GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
