"use client";

import { hexA, mkBez } from "@/lib/layout";
import styles from "./landing.module.css";
import { PHOTOS, photoBg } from "./tileStyle";
import PreviewHeader from "./PreviewHeader";

/** The hero's right column: the product's Topic view, in miniature. frame.io
 *  fills this slot with a 4K product video; we have none, so instead we render
 *  the exact thing the headline claims — an archive that "knows what's in it" —
 *  as the Topic canvas actually draws it: photo tiles packed into colored
 *  clouds, connected by lines that are real shared-tag relations, each cloud
 *  wearing its glowing topic label, all over the infinite-canvas grid.
 *
 *  Every visual here is lifted from the real components — the cloud blob
 *  (CloudDecor: radial-gradient at 0.22 alpha, blurred), the bezier edges
 *  (mkBez + the same opacity/width rules from lib/layout.ts), the glowing
 *  uppercase label (CloudLabels) — so the preview is the product, not an
 *  impression of it. The tiles stand in for photos as colored squares; nothing
 *  here is a real customer's frame.
 *
 *  Coordinates are hand-authored in a fixed 460×360 space and scale with the
 *  card. No Math.random — the repo bans it on anything that renders. */

const PAL = ["#39ff6a", "#5b9bff", "#ff7a5c", "#ffd166", "#c084fc", "#4fd1c5"];

const VW = 460;
const VH = 360;

/** Three clouds, each a topic with a color and a hand-placed set of photo
 *  tiles (golden-angle spiral around the centre — the same seeding packCircles
 *  uses in lib/layout.ts). */
const GOLDEN = 2.39996;
const CLOUDS = [
  { label: "yoga", color: PAL[0], cx: 132, cy: 156, n: 6 },
  { label: "street", color: PAL[4], cx: 336, cy: 120, n: 6 },
  { label: "travel", color: PAL[1], cx: 250, cy: 278, n: 5 },
];
/** Tile long-edge in view units, and its per-tile aspect seed. */
const TILE = 34;

type Tile = { x: number; y: number; w: number; h: number; preset: number };
type Cloud = { label: string; color: string; cx: number; cy: number; tiles: Tile[] };

// A tiny seeded PRNG so tile aspect/hue are varied but deterministic.
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCENE: Cloud[] = (() => {
  const r = rng(0x5eed);
  return CLOUDS.map((c) => {
    const tiles: Tile[] = Array.from({ length: c.n }, (_, i) => {
      const rad = 15 + Math.sqrt(i) * 21;
      const cx = c.cx + Math.cos(i * GOLDEN) * rad;
      const cy = c.cy + Math.sin(i * GOLDEN) * rad;
      const portrait = r() < 0.36;
      const w = portrait ? TILE * (0.72 + r() * 0.12) : TILE;
      const h = portrait ? TILE : TILE * (0.7 + r() * 0.14);
      return { x: cx - w / 2, y: cy - h / 2, w, h, preset: Math.floor(r() * PHOTOS.length) };
    });
    return { ...c, tiles };
  });
})();

const centreOf = (t: Tile) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });

/** Edges: same-cloud links (each tile → its cloud hub + its spiral neighbour),
 *  plus one gradient bridge between each adjacent pair of clouds — exactly the
 *  shape buildCloudLayout produces (a sparse web, one bridge per cloud pair). */
type Edge = { id: string; d: string; a: { x: number; y: number }; b: { x: number; y: number }; s0: string; s1: string; w: number; op: number };
const EDGES: Edge[] = (() => {
  const out: Edge[] = [];
  SCENE.forEach((c, ci) => {
    const hub = centreOf(c.tiles[0]);
    c.tiles.forEach((t, i) => {
      if (i === 0) return;
      const p = centreOf(t);
      out.push({ id: `t-${ci}-${i}`, d: mkBez(hub.x, hub.y, p.x, p.y, ci * 7 + i, 0.5), a: hub, b: p, s0: c.color, s1: c.color, w: 1, op: 0.3 });
      if (i > 1) {
        const q = centreOf(c.tiles[i - 1]);
        out.push({ id: `n-${ci}-${i}`, d: mkBez(q.x, q.y, p.x, p.y, ci * 13 + i, 0.5), a: q, b: p, s0: c.color, s1: c.color, w: 1, op: 0.22 });
      }
    });
  });
  // Cross-cloud bridges (gradient, heavier) — 0↔1, 1↔2, 0↔2.
  const pairs: [number, number][] = [[0, 1], [1, 2], [0, 2]];
  pairs.forEach(([i, j], k) => {
    const a = centreOf(SCENE[i].tiles[0]);
    const b = centreOf(SCENE[j].tiles[0]);
    out.push({ id: `x-${k}`, d: mkBez(a.x, a.y, b.x, b.y, k * 5 + 3, 0.62), a, b, s0: SCENE[i].color, s1: SCENE[j].color, w: 1.6, op: 0.42 });
  });
  return out;
})();

export default function HeroPreview() {
  return (
    <div className={styles.preview} aria-hidden="true">
      <PreviewHeader active="topic" />
      <div className={styles.topicScene}>
        <div className={styles.topicGrid} />

        {/* Colored cloud blobs — behind everything, exactly as CloudDecor draws
            them (radial-gradient, blurred, one per cloud). */}
        {SCENE.map((c) => {
          const xs = c.tiles.flatMap((t) => [t.x, t.x + t.w]);
          const ys = c.tiles.flatMap((t) => [t.y, t.y + t.h]);
          const xl = Math.min(...xs);
          const xr = Math.max(...xs);
          const yt = Math.min(...ys);
          const yb = Math.max(...ys);
          const pad = 30;
          return (
            <div
              key={`blob-${c.label}`}
              className={styles.topicBlob}
              style={{
                left: `${((xl - pad) / VW) * 100}%`,
                top: `${((yt - pad) / VH) * 100}%`,
                width: `${((xr - xl + pad * 2) / VW) * 100}%`,
                height: `${((yb - yt + pad * 2) / VH) * 100}%`,
                background: `radial-gradient(closest-side, ${hexA(c.color, 0.24)}, ${hexA(c.color, 0)})`,
              }}
            />
          );
        })}

        {/* Connecting lines — real relations, drawn between tile centres. */}
        <svg className={styles.topicEdges} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
          <defs>
            {EDGES.filter((e) => e.s0 !== e.s1).map((e) => (
              <linearGradient key={e.id} id={`hero-grad-${e.id}`} gradientUnits="userSpaceOnUse" x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}>
                <stop offset="0%" stopColor={e.s0} />
                <stop offset="100%" stopColor={e.s1} />
              </linearGradient>
            ))}
          </defs>
          {EDGES.map((e, i) => (
            <path
              key={e.id}
              className={styles.topicEdge}
              style={{ ["--i" as string]: i }}
              pathLength={1}
              d={e.d}
              stroke={e.s0 === e.s1 ? e.s0 : `url(#hero-grad-${e.id})`}
              strokeWidth={e.w}
              strokeOpacity={e.op}
              strokeLinecap="round"
              fill="none"
            />
          ))}
        </svg>

        {/* Photo tiles — colored squares standing in for analyzed photos. */}
        {SCENE.flatMap((c, ci) =>
          c.tiles.map((t, i) => (
            <div
              key={`tile-${ci}-${i}`}
              className={styles.topicTile}
              style={{
                left: `${(t.x / VW) * 100}%`,
                top: `${(t.y / VH) * 100}%`,
                width: `${(t.w / VW) * 100}%`,
                height: `${(t.h / VH) * 100}%`,
                ["--i" as string]: ci * 6 + i,
                background: photoBg(t.preset),
              }}
            >
              <span className={styles.tileGrain} />
              <span className={styles.topicTileGloss} />
            </div>
          )),
        )}

        {/* Glowing topic labels, on top — as CloudLabels renders them. */}
        {SCENE.map((c) => {
          const xs = c.tiles.flatMap((t) => [t.x, t.x + t.w]);
          const ys = c.tiles.map((t) => t.y);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const yt = Math.min(...ys);
          return (
            <span
              key={`label-${c.label}`}
              className={styles.topicLabel}
              style={{
                left: `${(cx / VW) * 100}%`,
                top: `${((yt - 22) / VH) * 100}%`,
                color: c.color,
                textShadow: `0 0 12px ${hexA(c.color, 0.55)}, 0 1px 3px rgba(0,0,0,0.7)`,
              }}
            >
              {c.label.toUpperCase()}
            </span>
          );
        })}
      </div>
    </div>
  );
}
