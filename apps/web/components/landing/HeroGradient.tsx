"use client";

import { useEffect, useRef } from "react";
import styles from "./landing.module.css";

/** The hero's living backdrop — our counterpart to frame.io's HeroGradient
 *  canvas. Four radial blobs drift on fixed sine paths and add together in
 *  "lighter" mode, painted onto a deliberately tiny canvas that the browser
 *  scales up: the upscale IS the blur, so this costs a few hundred pixels of
 *  fill per frame instead of a full-screen shader.
 *
 *  Phases and speeds are constants, not Math.random — the repo bans randomness
 *  on render paths (reproducibility), and a fixed seed also means every visitor
 *  sees the same opening frame. */

const W = 72;
const H = 40;

type Blob = {
  /** rgb triplet */
  c: [number, number, number];
  /** centre at t=0, in canvas units */
  x: number;
  y: number;
  /** drift amplitude */
  ax: number;
  ay: number;
  /** angular speed (rad/s) */
  sx: number;
  sy: number;
  /** radius in canvas units */
  r: number;
  /** peak alpha */
  a: number;
  /** phase offset (rad) */
  p: number;
};

/* Deep, desaturated greens carry the field; the bright brand green appears only
   as a small, weak highlight. Additive blending compounds fast — at full
   saturation four blobs read as a lime wash, not as light in a dark room. */
const BLOBS: Blob[] = [
  { c: [26, 122, 66], x: 0.18, y: 0.88, ax: 0.09, ay: 0.05, sx: 0.19, sy: 0.13, r: 0.34, a: 0.24, p: 0 },
  { c: [14, 74, 48], x: 0.62, y: 1.02, ax: 0.12, ay: 0.05, sx: 0.14, sy: 0.21, r: 0.4, a: 0.2, p: 1.9 },
  { c: [40, 56, 132], x: 0.92, y: 0.22, ax: 0.08, ay: 0.07, sx: 0.11, sy: 0.16, r: 0.3, a: 0.11, p: 3.4 },
  { c: [57, 255, 106], x: 0.3, y: 0.78, ax: 0.12, ay: 0.07, sx: 0.09, sy: 0.07, r: 0.13, a: 0.07, p: 5.1 },
];

export default function HeroGradient() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = W;
    canvas.height = H;

    const draw = (tSec: number) => {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#080808";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      for (const b of BLOBS) {
        const cx = (b.x + Math.sin(tSec * b.sx + b.p) * b.ax) * W;
        const cy = (b.y + Math.cos(tSec * b.sy + b.p) * b.ay) * H;
        const r = b.r * W;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const [rr, gg, bb] = b.c;
        g.addColorStop(0, `rgba(${rr},${gg},${bb},${b.a})`);
        g.addColorStop(0.55, `rgba(${rr},${gg},${bb},${b.a * 0.28})`);
        g.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    };

    // Reduced motion still gets the gradient — just frozen at its opening pose.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (still.matches) {
      draw(0);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      draw((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // A background tab shouldn't burn frames; rAF already throttles, but this
    // also stops the clock so the animation doesn't jump on return.
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className={styles.heroCanvas} aria-hidden="true" />;
}
