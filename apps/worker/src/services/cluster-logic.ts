/** Deterministic semantic clustering (ADR 0028) — the pure core of the
 *  `cluster` job. Zero Gemini calls: this is free CPU over the image
 *  embeddings the analyze job already stored. Everything here is a pure
 *  function of (inputs, existing clusters, workspace id) so the same corpus
 *  always yields the same clusters — no `Math.random`, no wall clock — which is
 *  what lets the worker keep cluster ids and labels stable across runs.
 *
 *  Pipeline: normalize → seeded k-means++ → Lloyd iterations → discriminative
 *  tag labels → greedy centroid matching against the previous run. */

export interface ClusterInput {
  assetId: string;
  /** The stored 768-dim image embedding (embeddings.embedding). */
  embedding: number[];
  tags: readonly { name: string; category: string }[];
}

/** A cluster as it currently exists in topic_clusters (for stability matching). */
export interface ExistingCluster {
  id: string;
  label: string;
  centroid: number[];
}

/** A freshly computed cluster before it is matched to an existing row. */
export interface ComputedCluster {
  centroid: number[];
  assetIds: string[];
}

export interface ClusterPlan {
  /** Matched to an existing cluster — keeps the old id AND label so the Topic
   *  view does not rename its clouds every run; centroid/size/members refresh. */
  update: { id: string; label: string; centroid: number[]; size: number; assetIds: string[] }[];
  /** New clusters with no good match — inserted with a fresh discriminative label. */
  insert: { label: string; centroid: number[]; size: number; assetIds: string[] }[];
  /** Existing clusters that no longer match anything — deleted (FK nulls their
   *  members' assets.cluster_id, dropping them back to the tag heuristic). */
  deleteIds: string[];
}

/** Below this many analyzed assets we do not cluster at all — the read-time tag
 *  heuristic (lib/topics.ts) already produces sensible clouds on small corpora,
 *  and k-means over a handful of points is noise. */
export const MIN_CLUSTER_ASSETS = 8;

/** Two centroids this cosine-similar or closer are "the same cluster" across
 *  runs — matched greedily so ids/labels survive. */
export const MATCH_THRESHOLD = 0.9;

/** Lloyd-iteration cap: bounds worst-case runtime on large workspaces; k-means
 *  on unit vectors converges well within this. */
export const MAX_ITERATIONS = 50;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** 32-bit FNV-1a — seeds the PRNG from the workspace id so each workspace has a
 *  stable-but-distinct k-means++ start. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny deterministic PRNG. The ONLY source of randomness in the
 *  clustering path (the no-`Math.random` rule that keeps layouts reproducible
 *  applies to the worker too). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k = clamp(round(sqrt(n/2)), 2, 12) — sub-linear in the corpus size so a big
 *  archive still resolves to a legible number of themes. */
export function pickK(n: number): number {
  return clamp(Math.round(Math.sqrt(n / 2)), 2, 12);
}

export function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function dot(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

function distSq(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function mean(vectors: number[][]): number[] {
  const dims = vectors[0].length;
  const out = new Array<number>(dims).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) out[i] += v[i];
  }
  for (let i = 0; i < dims; i++) out[i] /= vectors.length;
  return out;
}

/** Nearest centroid by max dot (unit vectors → max dot = min distance); ties go
 *  to the lowest centroid index so assignment is deterministic. */
function nearest(point: number[], centers: number[][]): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let c = 0; c < centers.length; c++) {
    const d = dot(point, centers[c]);
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
  }
  return best;
}

/** k-means++ seeding driven by the seeded PRNG. Points already chosen have
 *  squared-distance 0 so they are never re-picked by the weighted draw; the
 *  degenerate all-coincident case falls back to the lowest unused index. */
function kmeansPlusPlusInit(points: number[][], k: number, rng: () => number): number[][] {
  const n = points.length;
  const chosen = new Set<number>();
  const first = Math.min(n - 1, Math.floor(rng() * n));
  chosen.add(first);
  const centers = [points[first].slice()];
  const d2 = points.map((p) => distSq(p, centers[0]));

  while (centers.length < k) {
    let total = 0;
    for (const d of d2) total += d;
    let idx: number;
    if (total <= 0) {
      idx = 0;
      while (idx < n && chosen.has(idx)) idx++;
      if (idx >= n) break; // fewer distinct points than k — stop early
    } else {
      const r = rng() * total;
      let acc = 0;
      idx = n - 1;
      for (let i = 0; i < n; i++) {
        acc += d2[i];
        if (r < acc) {
          idx = i;
          break;
        }
      }
    }
    chosen.add(idx);
    centers.push(points[idx].slice());
    for (let i = 0; i < n; i++) {
      d2[i] = Math.min(d2[i], distSq(points[i], centers[centers.length - 1]));
    }
  }
  return centers;
}

/** The worst-served point (max distance to its own centroid) that can be moved
 *  without emptying its source cluster — used to reseed an empty cluster.
 *  Strict `>` keeps the lowest index on ties. */
function worstServedPoint(
  points: number[][],
  assign: number[],
  centers: number[][],
  members: number[][],
): number {
  let best = -1;
  let bestD = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (members[assign[i]].length <= 1) continue;
    const d = distSq(points[i], centers[assign[i]]);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Spherical k-means over the inputs' embeddings. Inputs are sorted by assetId
 *  first, so the whole result is invariant to the order rows arrive from the DB
 *  — the property the determinism unit test pins. Returns non-empty clusters,
 *  each with normalized centroid and ascending assetIds, ordered by their
 *  smallest assetId. */
export function clusterEmbeddings(inputs: readonly ClusterInput[], seedKey: string): ComputedCluster[] {
  const sorted = [...inputs].sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
  const points = sorted.map((r) => normalize(r.embedding));
  const n = points.length;
  const k = Math.min(pickK(n), n);
  const rng = mulberry32(fnv1a(seedKey));

  let centers = kmeansPlusPlusInit(points, k, rng);
  let assignment = new Array<number>(n).fill(-1);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const next = points.map((p) => nearest(p, centers));
    const members: number[][] = Array.from({ length: centers.length }, () => []);
    next.forEach((c, i) => members[c].push(i));

    // Reseed empties before recomputing so no centroid is left stale/undefined.
    for (let c = 0; c < members.length; c++) {
      if (members[c].length > 0) continue;
      const victim = worstServedPoint(points, next, centers, members);
      if (victim < 0) continue;
      members[next[victim]] = members[next[victim]].filter((x) => x !== victim);
      next[victim] = c;
      members[c].push(victim);
    }

    const newCenters = members.map((ms, c) => (ms.length ? normalize(mean(ms.map((i) => points[i]))) : centers[c]));
    const stable = next.every((v, i) => v === assignment[i]);
    assignment = next;
    centers = newCenters;
    if (stable) break;
  }

  const members: number[][] = Array.from({ length: centers.length }, () => []);
  assignment.forEach((c, i) => members[c].push(i));
  const clusters: ComputedCluster[] = [];
  for (let c = 0; c < members.length; c++) {
    if (members[c].length === 0) continue;
    clusters.push({
      centroid: centers[c],
      assetIds: members[c].map((i) => sorted[i].assetId), // ascending: members[c] built in index order
    });
  }
  clusters.sort((a, b) => (a.assetIds[0] < b.assetIds[0] ? -1 : 1));
  return clusters;
}

const THEMATIC_CATEGORIES = new Set(["event", "scene", "object"]);

export interface ClusterLabel {
  /** The default 2-tag label. */
  label: string;
  /** Ranked candidate tag names (most discriminative first) — the uniqueness
   *  pass pulls a 3rd/4th from here to break collisions before it resorts to a
   *  numeric suffix. */
  pool: string[];
}

/** Labels each cluster by its most *discriminative* tags: names concentrated in
 *  the cluster relative to the workspace (TF ratio = cluster doc-freq / ws
 *  doc-freq), thematic categories (event/scene/object) preferred, ties broken
 *  by cluster frequency then name. Top-2 joined with " · "; no tags →
 *  "Unlabeled". Gemini is never called — the tags are already there. */
export function labelClusters(
  clusters: readonly ComputedCluster[],
  allInputs: readonly ClusterInput[],
): ClusterLabel[] {
  const byAsset = new Map<string, ClusterInput>();
  for (const input of allInputs) byAsset.set(input.assetId, input);

  // Workspace document frequency per tag name (once per asset).
  const wsDf = new Map<string, number>();
  for (const input of allInputs) {
    for (const name of new Set(input.tags.map((t) => t.name))) {
      wsDf.set(name, (wsDf.get(name) ?? 0) + 1);
    }
  }

  return clusters.map((cluster) => {
    const clDf = new Map<string, number>();
    const thematic = new Set<string>();
    for (const assetId of cluster.assetIds) {
      const input = byAsset.get(assetId);
      if (!input) continue;
      const names = new Set<string>();
      for (const tag of input.tags) {
        names.add(tag.name);
        if (THEMATIC_CATEGORIES.has(tag.category)) thematic.add(tag.name);
      }
      for (const name of names) clDf.set(name, (clDf.get(name) ?? 0) + 1);
    }

    const names = [...clDf.keys()];
    const thematicNames = names.filter((n) => thematic.has(n));
    const poolNames = thematicNames.length > 0 ? thematicNames : names;
    poolNames.sort((a, b) => {
      const ra = (clDf.get(a) ?? 0) / (wsDf.get(a) ?? 1);
      const rb = (clDf.get(b) ?? 0) / (wsDf.get(b) ?? 1);
      return rb - ra || (clDf.get(b) ?? 0) - (clDf.get(a) ?? 0) || (a < b ? -1 : 1);
    });

    const label = poolNames.length > 0 ? poolNames.slice(0, 2).join(" · ") : "Unlabeled";
    return { label, pool: poolNames };
  });
}

/** Disambiguates a label against those already in use: widen to 3+ tags first
 *  (still meaningful), then fall back to a numeric suffix. Prevents two clusters
 *  collapsing into one Topic cloud, which keys on the label string. */
function uniqueLabel(base: ClusterLabel, used: Set<string>): string {
  for (let take = 2; take <= base.pool.length; take++) {
    const cand = base.pool.slice(0, take).join(" · ");
    if (!used.has(cand)) return cand;
  }
  const cand = base.label || "Unlabeled";
  if (!used.has(cand)) return cand;
  let n = 2;
  while (used.has(`${cand} (${n})`)) n++;
  return `${cand} (${n})`;
}

/** Greedy one-to-one centroid matching, highest cosine first. Ties break by
 *  existing index then computed index (callers pass `existing` sorted by id, so
 *  index order = id order — deterministic). Only pairs ≥ threshold match. */
export function matchClusters(
  computedCentroids: readonly number[][],
  existingCentroids: readonly number[][],
  threshold: number = MATCH_THRESHOLD,
): { matches: { computedIdx: number; existingIdx: number; sim: number }[]; unmatchedComputed: number[]; unmatchedExisting: number[] } {
  const pairs: { computedIdx: number; existingIdx: number; sim: number }[] = [];
  for (let i = 0; i < computedCentroids.length; i++) {
    for (let j = 0; j < existingCentroids.length; j++) {
      const sim = cosine(computedCentroids[i], existingCentroids[j]);
      if (sim >= threshold) pairs.push({ computedIdx: i, existingIdx: j, sim });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim || a.existingIdx - b.existingIdx || a.computedIdx - b.computedIdx);

  const usedC = new Set<number>();
  const usedE = new Set<number>();
  const matches: { computedIdx: number; existingIdx: number; sim: number }[] = [];
  for (const p of pairs) {
    if (usedC.has(p.computedIdx) || usedE.has(p.existingIdx)) continue;
    usedC.add(p.computedIdx);
    usedE.add(p.existingIdx);
    matches.push(p);
  }
  const unmatchedComputed = computedCentroids.map((_, i) => i).filter((i) => !usedC.has(i));
  const unmatchedExisting = existingCentroids.map((_, j) => j).filter((j) => !usedE.has(j));
  return { matches, unmatchedComputed, unmatchedExisting };
}

/** The full plan the handler applies in one transaction. Returns null when the
 *  workspace has too few analyzed assets to cluster (the heuristic covers it).
 *  Matched clusters keep their id + label; new clusters get a unique
 *  discriminative label; dropped clusters are deleted. */
export function planClusters(
  inputs: readonly ClusterInput[],
  existing: readonly ExistingCluster[],
  workspaceId: string,
): ClusterPlan | null {
  if (inputs.length < MIN_CLUSTER_ASSETS) return null;

  const computed = clusterEmbeddings(inputs, workspaceId);
  const labels = labelClusters(computed, inputs);
  const existingSorted = [...existing].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const { matches, unmatchedComputed, unmatchedExisting } = matchClusters(
    computed.map((c) => c.centroid),
    existingSorted.map((e) => e.centroid),
  );

  const used = new Set<string>();
  const update = matches
    .map((m) => {
      const c = computed[m.computedIdx];
      const e = existingSorted[m.existingIdx];
      used.add(e.label);
      return { id: e.id, label: e.label, centroid: c.centroid, size: c.assetIds.length, assetIds: c.assetIds };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const insert = unmatchedComputed.map((idx) => {
    const c = computed[idx];
    const label = uniqueLabel(labels[idx], used);
    used.add(label);
    return { label, centroid: c.centroid, size: c.assetIds.length, assetIds: c.assetIds };
  });

  const deleteIds = unmatchedExisting.map((j) => existingSorted[j].id).sort();

  return { update, insert, deleteIds };
}
