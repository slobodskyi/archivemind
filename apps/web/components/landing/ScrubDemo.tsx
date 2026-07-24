"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./landing.module.css";

/** The scroll-scrubbed product demo — this landing's answer to frame.io's
 *  image-sequence scrub, minus the 4K asset pipeline. A tall section pins a
 *  stage while scroll progress morphs the same tiles through the product's
 *  three real views: canvas grid → semantic clusters → map pins.
 *
 *  Two rules shape the implementation:
 *  - Positions are seeded (mulberry32), never Math.random. The repo bans
 *    randomness on layout paths, and a stable seed also keeps SSR and client
 *    agreeing on what the demo looks like.
 *  - Per-frame updates write transforms straight to the DOM. Re-rendering 34
 *    React nodes per scroll frame would drop frames for no benefit; only the
 *    active step (0/1/2), which changes twice, goes through state. */

const N = 34;

const STEPS = [
  {
    key: "canvas",
    label: "Canvas",
    title: "Everything on one infinite canvas.",
    caption: "drag · zoom · group into folders and artboards",
  },
  {
    key: "topic",
    label: "Topic",
    title: "Grouped by what they are actually about.",
    caption: "k-means over image embeddings — clusters stay put between sessions",
  },
  {
    key: "map",
    label: "Map",
    title: "Pinned exactly where they were taken.",
    caption: "EXIF GPS on a real map, reverse-geocoded offline",
  },
] as const;

const CLOUDS = ["yoga", "street", "studio", "travel"];
/** Cluster centres in normalised stage space. */
const CLOUD_AT: [number, number][] = [
  [0.22, 0.34],
  [0.63, 0.26],
  [0.33, 0.74],
  [0.78, 0.66],
];
/** Map pin centres — loose enough to read as geography, not a grid. */
const PIN_AT: [number, number][] = [
  [0.26, 0.42],
  [0.47, 0.58],
  [0.68, 0.63],
  [0.82, 0.3],
  [0.15, 0.72],
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smoothstep — eases both ends of every transition so nothing snaps. */
const ease = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Spec = {
  /** size multiplier against the tile size its grid cell allows */
  sz: number;
  aspect: number;
  hue: number;
  sat: number;
  cloud: number;
  pin: number;
  /** jitter, in cell fractions, for the canvas grid */
  jx: number;
  jy: number;
  /** index within its cluster / pin stack */
  ci: number;
  pi: number;
};

type Pose = { x: number; y: number; s: number };

/** Golden-angle spiral — the same trick packCircles uses in lib/layout.ts:
 *  evenly-spread points without overlap tests. */
const GOLDEN = 2.399963;

export default function ScrubDemo() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<(HTMLDivElement | null)[]>([]);
  const labelsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [still, setStill] = useState(false);

  const specs = useMemo<Spec[]>(() => {
    const rnd = mulberry32(0x5eed);
    const cloudCount = [0, 0, 0, 0];
    const pinCount = [0, 0, 0, 0, 0];
    return Array.from({ length: N }, (_, i) => {
      const cloud = i % CLOUDS.length;
      const pin = i % PIN_AT.length;
      return {
        sz: 0.8 + rnd() * 0.2,
        aspect: rnd() < 0.34 ? 0.74 + rnd() * 0.12 : 1.24 + rnd() * 0.24,
        hue: Math.floor(rnd() * 360),
        sat: 14 + rnd() * 18,
        cloud,
        pin,
        jx: (rnd() - 0.5) * 0.42,
        jy: (rnd() - 0.5) * 0.42,
        ci: cloudCount[cloud]++,
        pi: pinCount[pin]++,
      };
    });
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const field = fieldRef.current;
    if (!wrap || !field) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(reduce.matches);

    let size = { w: 0, h: 0 };
    let poses: { a: Pose[]; b: Pose[]; c: Pose[] } | null = null;
    let dims: { w: number; h: number }[] = [];
    /** Cloud radius, shared with apply() so labels sit on their own cluster. */
    let cloudR = 0;

    const build = () => {
      const { width: w, height: h } = field.getBoundingClientRect();
      if (w < 2 || h < 2) return;
      size = { w, h };

      // The canvas grid: 8 columns, gently jittered so it reads as a
      // hand-arranged board rather than a table.
      const cols = 8;
      const rows = Math.ceil(N / cols);
      const cellW = w / cols;
      const cellH = (h * 0.86) / rows;

      // Tile size is owned here, in pixels, because the same numbers centre the
      // transforms below — and it's derived from the cell, so a portrait tile
      // can't outgrow its row. Sizing in CSS and guessing here is how a scrub
      // ends up half a tile off at every breakpoint.
      dims = specs.map((s) => {
        const fit = Math.min(cellW * 0.86, cellH * 0.86 * s.aspect);
        const tw = fit * s.sz;
        return { w: tw, h: tw / s.aspect };
      });
      for (let i = 0; i < N; i++) {
        const el = tilesRef.current[i];
        if (!el) continue;
        el.style.width = `${dims[i].w}px`;
        el.style.height = `${dims[i].h}px`;
      }

      const a: Pose[] = specs.map((s, i) => ({
        x: (i % cols) * cellW + cellW / 2 + s.jx * cellW * 0.18,
        y: h * 0.07 + Math.floor(i / cols) * cellH + cellH / 2 + s.jy * cellH * 0.18,
        s: 1,
      }));

      // B — topic clouds: golden-angle spiral around each cluster centre. Tiles
      // shrink on the way in, otherwise nine of them inside one cloud radius
      // overlap into a single blob instead of reading as a cluster.
      //
      // Both radii scale off the tile, not the stage: a phone's stage is tall
      // and narrow, and a stage-relative radius scatters the clouds across it
      // until they stop reading as clusters at all.
      const unit = dims.reduce((sum, d) => sum + d.w, 0) / N;
      const R = unit * 1.55;
      cloudR = R;
      const b: Pose[] = specs.map((s) => {
        const [cx, cy] = CLOUD_AT[s.cloud];
        const k = s.ci;
        const rad = R * Math.sqrt((k + 0.6) / (N / CLOUDS.length));
        return {
          x: cx * w + Math.cos(k * GOLDEN) * rad,
          y: cy * h + Math.sin(k * GOLDEN) * rad,
          s: 0.7,
        };
      });

      // C — map pins: tight stacks, small enough to read as markers.
      const c: Pose[] = specs.map((s) => {
        const [cx, cy] = PIN_AT[s.pin];
        const k = s.pi;
        const rad = unit * 0.62 * Math.sqrt(k);
        return {
          x: cx * w + Math.cos(k * GOLDEN) * rad,
          y: cy * h + Math.sin(k * GOLDEN) * rad,
          s: 0.46,
        };
      });

      poses = { a, b, c };
    };

    const apply = (p: number) => {
      if (!poses) return;
      // Hold, move, hold, move, hold — the pauses are what make a scrub read as
      // three states rather than one continuous slide.
      const t1 = ease((p - 0.1) / 0.3);
      const t2 = ease((p - 0.56) / 0.3);

      for (let i = 0; i < N; i++) {
        const el = tilesRef.current[i];
        if (!el) continue;
        const { a, b, c } = poses;
        const x = lerp(lerp(a[i].x, b[i].x, t1), c[i].x, t2);
        const y = lerp(lerp(a[i].y, b[i].y, t1), c[i].y, t2);
        const s = lerp(lerp(a[i].s, b[i].s, t1), c[i].s, t2);
        const d = dims[i];
        el.style.transform = `translate3d(${x - d.w / 2}px, ${y - d.h / 2}px, 0) scale(${s})`;
      }

      // Cloud labels belong to the middle state only.
      const labelAlpha = Math.min(t1, 1 - t2);
      for (let i = 0; i < CLOUDS.length; i++) {
        const el = labelsRef.current[i];
        if (!el) continue;
        el.style.opacity = String(labelAlpha);
        el.style.left = `${CLOUD_AT[i][0] * size.w}px`;
        // Clear of the cloud's own edge, not a fraction of the stage — on a
        // tall phone stage that fraction parks the label three clouds away.
        el.style.top = `${CLOUD_AT[i][1] * size.h - cloudR - 26}px`;
      }

      setStep(p > 0.62 ? 2 : p > 0.3 ? 1 : 0);
    };

    const progress = () => {
      const rect = wrap.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return 0;
      return clamp01(-rect.top / travel);
    };

    build();
    apply(reduce.matches ? 0 : progress());
    setReady(true);

    if (reduce.matches) {
      const ro = new ResizeObserver(() => {
        build();
        apply(0);
      });
      ro.observe(field);
      return () => ro.disconnect();
    }

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        apply(progress());
      });
    };

    // The landing scrolls inside its own fixed container, so the scroll event
    // never reaches window — capture it on the way down instead.
    document.addEventListener("scroll", onScroll, true);
    const ro = new ResizeObserver(() => {
      build();
      apply(progress());
    });
    ro.observe(field);

    return () => {
      document.removeEventListener("scroll", onScroll, true);
      ro.disconnect();
    };
  }, [specs]);

  const active = STEPS[step];

  return (
    <section
      ref={wrapRef}
      className={styles.scrub}
      id="how"
      style={{ height: still ? "auto" : "360vh" }}
      aria-label="How ArchiveMind shows your archive"
    >
      <div
        className={styles.scrubSticky}
        style={still ? { position: "static", height: "78svh", minHeight: 520 } : undefined}
      >
        <div className={styles.scrubHead}>
          <h2 className={styles.scrubTitle}>
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={`${styles.scrubTitleLine}${i === step ? ` ${styles.scrubTitleOn}` : ""}`}
                aria-hidden={i !== step}
              >
                {s.title}
              </span>
            ))}
          </h2>

          <ol className={styles.scrubSteps}>
            {STEPS.map((s, i) => (
              <li key={s.key} className={`${styles.scrubStep}${i <= step ? ` ${styles.scrubStepOn}` : ""}`}>
                <span className={styles.scrubStepRail}>
                  <span
                    className={styles.scrubStepFill}
                    style={{ transform: `scaleX(${i <= step ? 1 : 0})`, transition: "transform .45s" }}
                  />
                </span>
                0{i + 1} {s.label}
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.stage}>
          <div className={styles.stageBar}>
            <span className={styles.stageDot} />
            <span className={styles.stageDot} />
            <span className={styles.stageDot} />
            <span className={styles.stageBarLabel}>archivemind / kyiv-archive</span>
            <span className={styles.stageBarRight}>{N * 37} photos</span>
          </div>

          <div ref={fieldRef} className={styles.stageField} style={{ opacity: ready ? 1 : 0 }}>
            <div className={styles.stageGrid} style={{ opacity: step === 2 ? 0 : 0.5 }} />
            <div className={`${styles.stageMap}${step === 2 ? ` ${styles.stageMapOn}` : ""}`} />

            {specs.map((s, i) => (
              <div
                key={i}
                ref={(el) => {
                  tilesRef.current[i] = el;
                }}
                className={styles.tile}
              >
                <span
                  className={styles.tileInner}
                  style={{
                    background: `linear-gradient(142deg, hsl(${s.hue} ${s.sat}% 34%), hsl(${(s.hue + 28) % 360} ${s.sat}% 15%))`,
                  }}
                />
                <span className={styles.tileGloss} />
              </div>
            ))}

            {CLOUDS.map((c, i) => (
              <div
                key={c}
                ref={(el) => {
                  labelsRef.current[i] = el;
                }}
                className={styles.cloudLabel}
                style={{ opacity: still ? 0 : undefined }}
              >
                {c}
              </div>
            ))}

            <span className={styles.stageCaption}>{active.caption}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
