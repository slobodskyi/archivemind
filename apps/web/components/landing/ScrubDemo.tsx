"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { hexA, mkBez } from "@/lib/layout";
import styles from "./landing.module.css";
import { PHOTOS, photoBg } from "./tileStyle";
import PreviewHeader, { type PreviewView } from "./PreviewHeader";

/** The scroll-scrubbed product demo — this landing's answer to frame.io's
 *  image-sequence scrub, minus the 4K asset pipeline. A tall section pins a
 *  stage while scroll progress morphs the same tiles through all four of the
 *  product's real views: canvas grid → timeline axis → semantic clusters →
 *  map pins. That's the same set of views the workspace ships (types/view.ts),
 *  in the order the tabs read.
 *
 *  Two rules shape the implementation:
 *  - Positions are seeded (mulberry32), never Math.random. The repo bans
 *    randomness on layout paths, and a stable seed also keeps SSR and client
 *    agreeing on what the demo looks like.
 *  - Per-frame updates write transforms straight to the DOM. Re-rendering 34
 *    React nodes per scroll frame would drop frames for no benefit; only the
 *    active step (0–3), which changes three times, goes through state. */

const N = 34;

const STEPS = [
  {
    key: "canvas",
    label: "Canvas",
    title: "Everything on one infinite canvas.",
    caption: "drag · zoom · collect files into focused workspaces",
  },
  {
    key: "timeline",
    label: "Timeline",
    title: "Laid out day by day, in order.",
    caption: "one evenly-spaced column per day — drag stays inside the date",
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

/** Timeline columns — the axis renders one tick per entry. */
const DAYS = ["04/06", "05/06", "06/06", "11/06", "12/06", "18/06", "19/06"];

/** The Map view's world map is a real vector world map (true coastlines) served
 *  from /public and drawn as a minimalist green outline (see MAP_SRC). Its
 *  cropped content box has this aspect (viewBox 1882×1019), which the fit below
 *  preserves. */
const MAP_SRC = "/landing-worldmap.svg";
const MAP_AR = 1882 / 1019;

/** Pin anchors as [u, v] fractions of the map's content box — hand-placed on
 *  the real continents (verified against the map itself), so every marker sits
 *  on land. Same box the map image fills, so pins and coastlines always agree. */
const PIN_UV: ReadonlyArray<readonly [number, number]> = [
  [0.13, 0.31], [0.17, 0.35], [0.21, 0.30], [0.24, 0.41],
  [0.29, 0.66], [0.31, 0.57], [0.27, 0.76],
  [0.48, 0.27], [0.51, 0.31],
  [0.49, 0.45], [0.52, 0.53], [0.54, 0.63],
  [0.60, 0.42], [0.65, 0.44],
  [0.70, 0.33], [0.77, 0.30], [0.83, 0.37],
  [0.85, 0.72],
];

/** Fits the map's content box into the stage, preserving its aspect — the SAME
 *  fit for the image and the pins, so a pin always sits on a continent. The
 *  stage is wider, so it centres with ocean margins. */
function mapFit(w: number, h: number) {
  let mw = w * 0.94;
  let mh = mw / MAP_AR;
  if (mh > h * 0.92) {
    mh = h * 0.92;
    mw = mh * MAP_AR;
  }
  return { ox: (w - mw) / 2, oy: (h - mh) / 2, mw, mh };
}

/** Where the date axis sits in the stage, as a fraction of its height. Shared
 *  between the pose maths and the axis element so they can't drift apart. */
const AXIS_AT = 0.52;

/** The Map view's real cloud palette (lib/layout.ts MAP_CLOUD_COLORS) — so the
 *  demo's topic clouds and timeline day-bands wear the exact colors the product
 *  assigns. */
const PAL = ["#39ff6a", "#5b9bff", "#ff7a5c", "#ffd166", "#c084fc", "#4fd1c5"];

const CLOUDS = ["yoga", "street", "studio", "travel"];
/** Each cloud's color, by index — same order buildCloudLayout hands them out. */
const CLOUD_COLOR = CLOUDS.map((_, i) => PAL[i % PAL.length]);
/** Cluster centres in normalised stage space (order: yoga, street, studio,
 *  travel). Kept clear of the very top so a cloud's label — which sits above
 *  its tiles — never crops under the header: yoga top-left, street top-right,
 *  studio bottom-left, travel bottom-right. */
const CLOUD_AT: [number, number][] = [
  [0.24, 0.34],
  [0.63, 0.34],
  [0.30, 0.72],
  [0.78, 0.72],
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
  /** index into PHOTOS — the camera-roll image this tile wears */
  preset: number;
  cloud: number;
  /** timeline column */
  day: number;
  /** jitter, in cell fractions, shared by the canvas grid and the map pins */
  jx: number;
  jy: number;
  /** index within its cluster / day column */
  ci: number;
  di: number;
};

type Pose = { x: number; y: number; s: number };

/** The Topic view's decorative layer, computed once per layout (not per frame):
 *  the colored cloud blobs, the shared-tag connecting lines, and the glowing
 *  labels — the exact three things CloudDecor + CloudLabels draw. */
type TopicDecor = {
  w: number;
  h: number;
  blobs: { x: number; y: number; w: number; h: number; color: string }[];
  edges: { id: string; d: string; s0: string; s1: string; x1: number; y1: number; x2: number; y2: number; w: number; op: number }[];
  labels: { x: number; y: number; color: string; text: string }[];
};

/** Golden-angle spiral — the same trick packCircles uses in lib/layout.ts:
 *  evenly-spread points without overlap tests. */
const GOLDEN = 2.399963;

export default function ScrubDemo() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<(HTMLDivElement | null)[]>([]);
  const topicRef = useRef<HTMLDivElement>(null);
  const topicLabelsRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [still, setStill] = useState(false);
  const [topic, setTopic] = useState<TopicDecor | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);

  /** The dotted world map for the Map view, laid into the stage's own pixel
   *  space (recomputed only on resize, never per frame). */
  const worldMap = useMemo(() => {
    if (!stage) return null;
    const { ox, oy, mw, mh } = mapFit(stage.w, stage.h);
    return { ox, oy, mw, mh };
  }, [stage]);

  const specs = useMemo<Spec[]>(() => {
    const rnd = mulberry32(0x5eed);
    const cloudCount = [0, 0, 0, 0];
    const dayCount = DAYS.map(() => 0);
    return Array.from({ length: N }, (_, i) => {
      const cloud = i % CLOUDS.length;
      const day = i % DAYS.length;
      return {
        sz: 0.8 + rnd() * 0.2,
        aspect: rnd() < 0.34 ? 0.74 + rnd() * 0.12 : 1.24 + rnd() * 0.24,
        preset: Math.floor(rnd() * PHOTOS.length),
        cloud,
        day,
        jx: (rnd() - 0.5) * 0.42,
        jy: (rnd() - 0.5) * 0.42,
        ci: cloudCount[cloud]++,
        di: dayCount[day]++,
      };
    });
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const field = fieldRef.current;
    if (!wrap || !field) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(reduce.matches);

    let poses: { a: Pose[]; t: Pose[]; b: Pose[]; c: Pose[] } | null = null;
    let dims: { w: number; h: number }[] = [];

    const build = () => {
      const { width: w, height: h } = field.getBoundingClientRect();
      if (w < 2 || h < 2) return;

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

      const unit = dims.reduce((sum, d) => sum + d.w, 0) / N;
      const unitH = dims.reduce((sum, d) => sum + d.h, 0) / N;

      // T — the timeline: one evenly-spaced column per day, tiles stacked
      // outward from a horizontal date axis, alternating above and below it.
      // That's ADR 0024's layout, not a second grid.
      const colW = w / DAYS.length;
      const axisY = h * AXIS_AT;
      const tScale = 0.58;
      const rowStep = unitH * tScale + 7;
      // The date label is centred on the axis; AXIS_GAP is the clear space from
      // the axis to the nearest tile EDGE, applied equally above and below, so
      // photos never touch the date and the spacing reads symmetric.
      const AXIS_GAP = 30;
      const t: Pose[] = specs.map((s) => {
        const side = s.di % 2 === 0 ? -1 : 1;
        const rank = Math.floor(s.di / 2);
        return {
          x: colW * (s.day + 0.5),
          y: axisY + side * (AXIS_GAP + (unitH * tScale) / 2 + rank * rowStep),
          s: tScale,
        };
      });

      // B — topic clouds: golden-angle spiral around each cluster centre. Tiles
      // shrink on the way in, otherwise nine of them inside one cloud radius
      // overlap into a single blob instead of reading as a cluster.
      //
      // Both radii scale off the tile, not the stage: a phone's stage is tall
      // and narrow, and a stage-relative radius scatters the clouds across it
      // until they stop reading as clusters at all.
      const R = unit * 1.55;
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

      // C — map pins: only half the tiles show on the map, and each of those
      // sits on a real city (same fit the outline uses), spread across the
      // continents. The other half scale to nothing — a map shows the geotagged
      // photos, not the whole archive.
      const fit = mapFit(w, h);
      const onMap = specs.map((_, i) => i).filter((i) => i % 2 === 0);
      const c: Pose[] = specs.map((s, i) => {
        const vi = onMap.indexOf(i);
        if (vi < 0) return { x: b[i].x, y: b[i].y, s: 0 };
        const [u, v] = PIN_UV[Math.floor(((vi + 0.5) * PIN_UV.length) / onMap.length) % PIN_UV.length];
        return { x: fit.ox + u * fit.mw, y: fit.oy + v * fit.mh, s: 0.46 };
      });

      poses = { a, t, b, c };

      // Topic decor — computed off the settled topic poses (b), exactly as
      // CloudDecor derives its blobs/edges/labels from the live tile bbox.
      const blobs: TopicDecor["blobs"] = [];
      const labels: TopicDecor["labels"] = [];
      const hubOf: number[] = []; // first tile index per cloud (its ci===0)
      for (let cl = 0; cl < CLOUDS.length; cl++) {
        let xl = Infinity,
          yt = Infinity,
          xr = -Infinity,
          yb = -Infinity,
          hub = -1;
        for (let i = 0; i < N; i++) {
          if (specs[i].cloud !== cl) continue;
          if (specs[i].ci === 0) hub = i;
          const hw = (dims[i].w * b[i].s) / 2;
          const hh = (dims[i].h * b[i].s) / 2;
          xl = Math.min(xl, b[i].x - hw);
          yt = Math.min(yt, b[i].y - hh);
          xr = Math.max(xr, b[i].x + hw);
          yb = Math.max(yb, b[i].y + hh);
        }
        hubOf[cl] = hub;
        const pad = 34;
        blobs.push({ x: xl - pad, y: yt - pad, w: xr - xl + pad * 2, h: yb - yt + pad * 2, color: CLOUD_COLOR[cl] });
        labels.push({ x: (xl + xr) / 2, y: yt - 22, color: CLOUD_COLOR[cl], text: CLOUDS[cl] });
      }

      // Edges — same-cloud links (each tile → its cloud hub, plus its spiral
      // neighbour) and one gradient bridge per adjacent cloud pair, the sparse
      // web buildCloudLayout produces. Opacity/width follow lib/layout.ts.
      const edges: TopicDecor["edges"] = [];
      const centres = b.map((p) => ({ x: p.x, y: p.y }));
      for (let cl = 0; cl < CLOUDS.length; cl++) {
        const members: number[] = [];
        for (let i = 0; i < N; i++) if (specs[i].cloud === cl) members.push(i);
        members.sort((i, j) => specs[i].ci - specs[j].ci);
        const hub = hubOf[cl];
        members.forEach((i, k) => {
          if (i === hub) return;
          const p = centres[hub],
            q = centres[i];
          edges.push({ id: `t-${cl}-${k}`, d: mkBez(p.x, p.y, q.x, q.y, cl * 7 + k, 0.5), s0: CLOUD_COLOR[cl], s1: CLOUD_COLOR[cl], x1: p.x, y1: p.y, x2: q.x, y2: q.y, w: 1, op: 0.3 });
          if (k > 1) {
            const r = centres[members[k - 1]];
            edges.push({ id: `n-${cl}-${k}`, d: mkBez(r.x, r.y, q.x, q.y, cl * 13 + k, 0.5), s0: CLOUD_COLOR[cl], s1: CLOUD_COLOR[cl], x1: r.x, y1: r.y, x2: q.x, y2: q.y, w: 1, op: 0.22 });
          }
        });
      }
      const bridges: [number, number][] = [[0, 1], [1, 3], [2, 3], [0, 2]];
      bridges.forEach(([i, j], k) => {
        const p = centres[hubOf[i]],
          q = centres[hubOf[j]];
        edges.push({ id: `x-${k}`, d: mkBez(p.x, p.y, q.x, q.y, k * 5 + 3, 0.62), s0: CLOUD_COLOR[i], s1: CLOUD_COLOR[j], x1: p.x, y1: p.y, x2: q.x, y2: q.y, w: 1.6, op: 0.42 });
      });

      setTopic({ w, h, blobs, edges, labels });
      setStage({ w, h });
    };

    const apply = (p: number) => {
      if (!poses) return;
      // Hold, move, hold, move, hold, move, hold — the pauses are what make a
      // scrub read as four discrete views rather than one continuous slide.
      const t1 = ease((p - 0.08) / 0.2);
      const t2 = ease((p - 0.38) / 0.2);
      const t3 = ease((p - 0.66) / 0.2);

      for (let i = 0; i < N; i++) {
        const el = tilesRef.current[i];
        if (!el) continue;
        const { a, t, b, c } = poses;
        const x = lerp(lerp(lerp(a[i].x, t[i].x, t1), b[i].x, t2), c[i].x, t3);
        const y = lerp(lerp(lerp(a[i].y, t[i].y, t1), b[i].y, t2), c[i].y, t3);
        const s = lerp(lerp(lerp(a[i].s, t[i].s, t1), b[i].s, t2), c[i].s, t3);
        const d = dims[i];
        el.style.transform = `translate3d(${x - d.w / 2}px, ${y - d.h / 2}px, 0) scale(${s})`;
      }

      // The whole timeline decor layer (axis + bands + colored labels) belongs
      // to the timeline state; the whole topic layer (blobs + lines + labels)
      // to the topic state. Each fades in with its transition and out with the
      // next — the landing's stand-in for CloudDecor's edgesReady gating.
      if (timelineRef.current) timelineRef.current.style.opacity = String(Math.min(t1, 1 - t2));
      const topicAlpha = String(Math.min(t2, 1 - t3));
      if (topicRef.current) topicRef.current.style.opacity = topicAlpha;
      if (topicLabelsRef.current) topicLabelsRef.current.style.opacity = topicAlpha;
      // The world map belongs to the map state only — fades in as the tiles
      // settle into their pins.
      if (mapRef.current) mapRef.current.style.opacity = String(t3);

      setStep(p > 0.72 ? 3 : p > 0.46 ? 2 : p > 0.18 ? 1 : 0);
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

  return (
    <section
      ref={wrapRef}
      className={styles.scrub}
      id="how"
      style={{ height: still ? "auto" : "480vh" }}
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
          <PreviewHeader active={STEPS[step].key as PreviewView} />
          <div ref={fieldRef} className={styles.stageField} style={{ opacity: ready ? 1 : 0 }}>
            {/* Canvas owns the grid outright; timeline and topic keep a trace of
                it so the stage doesn't go flat; the map replaces it entirely. */}
            <div
              className={styles.stageGrid}
              style={{ opacity: step === 0 ? 0.5 : step === 3 ? 0.22 : 0.18 }}
            />
            <div className={`${styles.stageMap}${step === 3 ? ` ${styles.stageMapOn}` : ""}`} />

            {/* Map decor — a real vector world map (true coastlines) drawn as a
                minimalist green outline, so the Map step clearly previews the
                product's geographic map view. Behind the tiles, which settle
                into pins over the continents. */}
            {stage && worldMap && (
              <div ref={mapRef} className={styles.worldMap} style={{ opacity: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={MAP_SRC}
                  alt=""
                  style={{ position: "absolute", left: worldMap.ox, top: worldMap.oy, width: worldMap.mw, height: worldMap.mh }}
                />
              </div>
            )}

            {/* Timeline decor — the date axis, each day's colored band, tick and
                glowing date label. Pinned by percentage to the evenly-spaced
                columns; the whole layer fades with the timeline state. Matches
                CloudDecor's timeline branch (band + tick) + CloudLabels. */}
            <div ref={timelineRef} className={styles.tlDecor} style={{ opacity: 0 }}>
              <div className={styles.tlAxis} style={{ top: `${AXIS_AT * 100}%` }} />
              {DAYS.map((d, i) => {
                const left = `${((i + 0.5) / DAYS.length) * 100}%`;
                const color = PAL[i % PAL.length];
                return (
                  <Fragment key={d}>
                    <div
                      className={styles.tlBand}
                      style={{
                        left,
                        top: `${(AXIS_AT - 0.32) * 100}%`,
                        width: `${(100 / DAYS.length) * 0.8}%`,
                        height: "64%",
                        background: `radial-gradient(closest-side, ${hexA(color, 0.42)}, ${hexA(color, 0)})`,
                      }}
                    />
                    <span
                      className={styles.tlLabel}
                      style={{
                        left,
                        top: `${AXIS_AT * 100}%`,
                        color,
                        textShadow: `0 0 12px ${hexA(color, 0.5)}, 0 1px 3px rgba(0,0,0,0.7)`,
                      }}
                    >
                      {d}
                    </span>
                  </Fragment>
                );
              })}
            </div>

            {/* Topic decor — the colored cloud blobs, the shared-tag connecting
                lines and the glowing labels, computed off the settled topic
                poses. The whole layer fades with the topic state. */}
            {topic && (
              <div ref={topicRef} className={styles.topicDecor} style={{ opacity: 0 }}>
                {topic.blobs.map((bl, i) => (
                  <div
                    key={`blob-${i}`}
                    className={styles.cloudBlob}
                    style={{
                      left: bl.x,
                      top: bl.y,
                      width: bl.w,
                      height: bl.h,
                      background: `radial-gradient(closest-side, ${hexA(bl.color, 0.22)}, ${hexA(bl.color, 0)})`,
                    }}
                  />
                ))}
                <svg className={styles.cloudEdges} width={topic.w} height={topic.h} style={{ overflow: "visible" }}>
                  <defs>
                    {topic.edges
                      .filter((e) => e.s0 !== e.s1)
                      .map((e) => (
                        <linearGradient key={e.id} id={`scrub-grad-${e.id}`} gradientUnits="userSpaceOnUse" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}>
                          <stop offset="0%" stopColor={e.s0} />
                          <stop offset="100%" stopColor={e.s1} />
                        </linearGradient>
                      ))}
                  </defs>
                  {topic.edges.map((e) => (
                    <path
                      key={e.id}
                      d={e.d}
                      stroke={e.s0 === e.s1 ? e.s0 : `url(#scrub-grad-${e.id})`}
                      strokeWidth={e.w}
                      strokeOpacity={e.op}
                      strokeLinecap="round"
                      fill="none"
                    />
                  ))}
                </svg>
              </div>
            )}

            {specs.map((s, i) => (
              <div
                key={i}
                ref={(el) => {
                  tilesRef.current[i] = el;
                }}
                className={styles.tile}
              >
                <span className={styles.tileInner} style={{ background: photoBg(s.preset) }} />
                <span className={styles.tileGrain} />
                <span className={styles.tileGloss} />
              </div>
            ))}

            {/* Cloud labels sit on top of the tiles they name (CloudLabels'
                z-index 2), so they're a second layer after the tiles, sharing
                the topic state's fade. */}
            {topic && (
              <div ref={topicLabelsRef} className={styles.topicLabels} style={{ opacity: 0 }}>
                {topic.labels.map((l, i) => (
                  <span
                    key={`label-${i}`}
                    className={styles.cloudLabel}
                    style={{ left: l.x, top: l.y, color: l.color, textShadow: `0 0 12px ${hexA(l.color, 0.55)}, 0 1px 3px rgba(0,0,0,0.7)` }}
                  >
                    {l.text.toUpperCase()}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
