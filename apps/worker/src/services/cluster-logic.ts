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
  /** topic_clusters.is_renamed — a human named this cloud (ADR 0038). Its label
   *  is then never recomputed, and the cluster is never deleted for failing to
   *  match; it is retained (emptied) so the name survives a corpus dip and can
   *  be re-adopted later. Optional so existing call sites keep compiling. */
  isRenamed?: boolean;
}

/** A freshly computed cluster before it is matched to an existing row. */
export interface ComputedCluster {
  centroid: number[];
  assetIds: string[];
}

export interface ClusterPlan {
  /** Matched to an existing cluster — keeps the old id, so a cloud's identity
   *  (and every override anchored to it) survives the run. `label` is what is
   *  stored today; `relabel` is the name this run computed for it, or null when
   *  the label must be left alone (a user renamed it — ADR 0038). */
  update: { id: string; label: string; relabel: string | null; centroid: number[]; size: number; assetIds: string[] }[];
  /** New clusters with no good match — inserted with a fresh discriminative label. */
  insert: { label: string; centroid: number[]; size: number; assetIds: string[] }[];
  /** Existing clusters that no longer match anything — deleted (FK nulls their
   *  members' assets.cluster_id, dropping them back to the tag heuristic). */
  deleteIds: string[];
  /** Unmatched clusters a human NAMED. Deleting these would throw the rename
   *  away for good, so they are retained and emptied (size 0, no members)
   *  instead — invisible in the Topic view until a future run's centroid
   *  matches them again, at which point the user's name comes back with it. */
  retainIds: string[];
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

/** Separator between the two tags of a machine-generated label. */
export const LABEL_JOIN = " · ";
/** Label for a cluster whose members carry no tags at all. */
export const UNLABELED = "Unlabeled";

/** Medium / format / framing words. They describe HOW a photo was made, not
 *  what it is about, so they name no theme — a pile of unrelated phone
 *  screenshots ends up called "screenshot · smartphone", which tells the reader
 *  nothing they could not see from the thumbnails.
 *
 *  DEMOTED, never banned: a cluster that genuinely is nothing but screenshots
 *  falls through to the last tier and gets called "screenshot", which is the
 *  honest name for it. Matching is by NAME, not category — the analyze prompt
 *  (packages/shared) gives Gemini no vocabulary guidance, so these arrive as
 *  ordinary `scene`/`object` tags and no category filter can catch them. Every
 *  stored name is lowercased on insert (analyze.ts), so no case folding here. */
export const LABEL_STOPLIST: ReadonlySet<string> = new Set([
  "screenshot",
  "screen",
  "screen capture",
  "smartphone",
  "phone",
  "mobile phone",
  "camera",
  "photo",
  "photograph",
  "photography",
  "image",
  "picture",
  "selfie",
  "close-up",
  "closeup",
  "portrait",
  "black and white",
  "monochrome",
  "grayscale",
  "blurry",
  "blur",
  "grain",
  "digital",
  "film",
  "text",
]);

/** A candidate must cover at least LABEL_MIN_SUPPORT_NUM/DEN of its cluster AND
 *  at least LABEL_MIN_COUNT photos before it may name it. Kept as a rational so
 *  the check stays integer-exact (see `compareCandidates`).
 *
 *  This is the fix for the defect that produced "book cover · price tag" over a
 *  cluster of screenshots: under a pure discriminativeness ratio a tag on ONE
 *  photo scores clDf/wsDf = 1/1 = 1.0, the maximum possible, and beats a tag
 *  carried by every member of the cluster. Applied as a RELAXING TIER, never a
 *  hard gate — a small or noisy cluster degrades to a weaker label, not to
 *  "Unlabeled". */
export const LABEL_MIN_SUPPORT_NUM = 1;
export const LABEL_MIN_SUPPORT_DEN = 4;
export const LABEL_MIN_COUNT = 2;

/** A second tag joins the label only if it scores at least this share of the
 *  first (a rational, for the same integer-exactness reason). Without it the
 *  old `slice(0, 2)` always padded, naming an 80-photo cluster "street · yoga"
 *  off a tag that covered two of them. */
export const LABEL_SECOND_TAG_NUM = 2;
export const LABEL_SECOND_TAG_DEN = 5;

const isStopWord = (name: string): boolean => LABEL_STOPLIST.has(name);

/** Coverage gate: clDf ≥ LABEL_MIN_COUNT and clDf/size ≥ 1/4, without division. */
function meetsSupport(count: number, clusterSize: number): boolean {
  return count >= LABEL_MIN_COUNT && count * LABEL_MIN_SUPPORT_DEN >= clusterSize * LABEL_MIN_SUPPORT_NUM;
}

/** Ranks `a` above `b` for naming a cluster.
 *
 *  score(t) = support(t) × lift(t) = (clDf/size) × (clDf/wsDf). `size` is
 *  constant inside a cluster, so ordering by clDf²/wsDf is equivalent — and
 *  that is a ratio of two integers, compared here by cross-multiplication so no
 *  float ordering ever enters the plan (the determinism contract this module
 *  lives by). Ties fall to cluster frequency, then name, exactly as before.
 *
 *  The squared term is what makes a one-photo outlier lose: a tag on 18 of 20
 *  photos scores 18²/20 = 16.2 against a hapax's 1²/1 = 1. */
export function compareCandidates(
  a: string,
  b: string,
  clDf: ReadonlyMap<string, number>,
  wsDf: ReadonlyMap<string, number>,
): number {
  const ca = clDf.get(a) ?? 0;
  const cb = clDf.get(b) ?? 0;
  const wa = wsDf.get(a) ?? 1;
  const wb = wsDf.get(b) ?? 1;
  return cb * cb * wa - ca * ca * wb || cb - ca || (a < b ? -1 : 1);
}

/** True when `b` scores at least LABEL_SECOND_TAG_NUM/DEN of `a`'s score.
 *  score(b)/score(a) ≥ n/d ⟺ d·clDf(b)²·wsDf(a) ≥ n·clDf(a)²·wsDf(b). */
function secondTagEarnsIts(
  first: string,
  second: string,
  clDf: ReadonlyMap<string, number>,
  wsDf: ReadonlyMap<string, number>,
): boolean {
  const c1 = clDf.get(first) ?? 0;
  const c2 = clDf.get(second) ?? 0;
  const w1 = wsDf.get(first) ?? 1;
  const w2 = wsDf.get(second) ?? 1;
  return LABEL_SECOND_TAG_DEN * c2 * c2 * w1 >= LABEL_SECOND_TAG_NUM * c1 * c1 * w2;
}

/** The candidate ladder. The FIRST non-empty tier wins; tiers relax one
 *  constraint each, so every cluster with any tag at all gets some name:
 *
 *    1. thematic category · not a medium word · covers the cluster
 *    2. any category      · not a medium word · covers the cluster
 *    3. any category      · not a medium word
 *    4. anything, medium words included
 *
 *  Tier 3 is why a 2-photo cluster tagged only `place/kyiv` is still called
 *  "kyiv" rather than "Unlabeled"; tier 4 is why a cluster that really is all
 *  screenshots is called "screenshot". */
export function candidateTiers(
  clDf: ReadonlyMap<string, number>,
  thematic: ReadonlySet<string>,
  clusterSize: number,
): string[] {
  const names = [...clDf.keys()];
  const covers = (n: string) => meetsSupport(clDf.get(n) ?? 0, clusterSize);
  const tiers: string[][] = [
    names.filter((n) => !isStopWord(n) && thematic.has(n) && covers(n)),
    names.filter((n) => !isStopWord(n) && covers(n)),
    names.filter((n) => !isStopWord(n)),
    names,
  ];
  return tiers.find((t) => t.length > 0) ?? [];
}

export interface ClusterLabel {
  /** The label this run computed: one or two tags joined by LABEL_JOIN. */
  label: string;
  /** Ranked candidate tag names (best first) — `uniqueLabel` draws a different
   *  second (or first) tag from here to break a collision. */
  pool: string[];
}

/** Names each cluster from its own tags. Gemini is never called.
 *
 *  A good cloud name has to be BOTH representative (most of the cluster carries
 *  it) and discriminative (the rest of the workspace does not) — ADR 0028 asked
 *  only for the second, which is why one photo of a book cover could name a
 *  cluster of screenshots. `compareCandidates` scores both at once; the tier
 *  ladder keeps medium/format words out of the running unless nothing else is
 *  left; and the second tag has to earn its place instead of being padded in. */
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
    let sized = 0;
    for (const assetId of cluster.assetIds) {
      const input = byAsset.get(assetId);
      if (!input) continue;
      sized += 1;
      const names = new Set<string>();
      for (const tag of input.tags) {
        names.add(tag.name);
        if (THEMATIC_CATEGORIES.has(tag.category)) thematic.add(tag.name);
      }
      for (const name of names) clDf.set(name, (clDf.get(name) ?? 0) + 1);
    }

    const pool = candidateTiers(clDf, thematic, sized).sort((a, b) => compareCandidates(a, b, clDf, wsDf));
    if (pool.length === 0) return { label: UNLABELED, pool };
    // A medium word never gets a partner. Tiers 1-3 exclude stop words
    // entirely, so a stop-listed best candidate means tier 4 — the cluster
    // really is defined by its medium — and "screenshot · smartphone" says
    // nothing "screenshot" does not. One honest word beats two.
    const pairable = pool.length > 1 && !isStopWord(pool[0]) && secondTagEarnsIts(pool[0], pool[1], clDf, wsDf);
    return { label: pairable ? `${pool[0]}${LABEL_JOIN}${pool[1]}` : pool[0], pool };
  });
}

/** Disambiguates a label against those already taken this run — two clusters
 *  sharing a label would merge into ONE Topic cloud, which keys on the string.
 *
 *  It differentiates by SWAPPING a tag, never by appending one: the old widening
 *  loop produced "floor · mat" next to "floor · mat · wall", two names a reader
 *  cannot tell apart, and could run to a 20-tag label. Two tags is the cap; the
 *  numeric suffix is the last resort (and the only option for the tagless
 *  clusters that all resolve to "Unlabeled"). */
export function uniqueLabel(base: ClusterLabel, used: ReadonlySet<string>): string {
  if (!used.has(base.label)) return base.label;
  const pool = base.pool;
  for (let i = 0; i < pool.length; i++) {
    for (let j = 0; j < pool.length; j++) {
      if (i === j) continue;
      const cand = `${pool[i]}${LABEL_JOIN}${pool[j]}`;
      if (!used.has(cand)) return cand;
    }
  }
  for (const name of pool) {
    if (!used.has(name)) return name;
  }
  const stem = base.label || UNLABELED;
  let n = 2;
  while (used.has(`${stem} (${n})`)) n++;
  return `${stem} (${n})`;
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
 *
 *  Matched clusters keep their **id** — that is what makes a cloud's identity,
 *  and every canvas override anchored to it, survive a run. Their **name** is
 *  recomputed unless a human pinned it (ADR 0038): ADR 0028 froze the first
 *  machine guess forever, which meant a bad name was permanent and any
 *  improvement to the labeller could never reach an existing workspace. A pin
 *  (`is_renamed`) is now the way to keep a name, and it also protects the
 *  cluster from being deleted when its centroid stops matching. */
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

  // Unmatched clusters split by who named them: a machine name is dropped, a
  // human's is retained (emptied) so the rename outlives a corpus dip.
  const deleteIds: string[] = [];
  const retainIds: string[] = [];
  for (const j of unmatchedExisting) {
    (existingSorted[j].isRenamed ? retainIds : deleteIds).push(existingSorted[j].id);
  }

  // ── pass 1: reserve every name that survives this run, before choosing any
  // new one. `matches` arrives in greedy-similarity order — a FLOAT ordering —
  // so nothing that decides a label may iterate it. Seeding here and assigning
  // below in id order keeps the plan a pure function of the corpus.
  const used = new Set<string>();
  for (const m of matches) {
    const e = existingSorted[m.existingIdx];
    if (e.isRenamed) used.add(e.label);
  }
  for (const id of retainIds) {
    const e = existingSorted.find((x) => x.id === id);
    if (e) used.add(e.label);
  }

  // ── pass 2: assign, iterating in a stable key order (existing id, then
  // computed index). existingSorted is id-sorted, so existingIdx order IS id
  // order.
  const update = [...matches]
    .sort((a, b) => a.existingIdx - b.existingIdx)
    .map((m) => {
      const c = computed[m.computedIdx];
      const e = existingSorted[m.existingIdx];
      let relabel: string | null = null;
      if (!e.isRenamed) {
        relabel = uniqueLabel(labels[m.computedIdx], used);
        used.add(relabel);
      }
      return {
        id: e.id,
        label: e.label,
        relabel,
        centroid: c.centroid,
        size: c.assetIds.length,
        assetIds: c.assetIds,
      };
    });

  const insert = unmatchedComputed.map((idx) => {
    const c = computed[idx];
    const label = uniqueLabel(labels[idx], used);
    used.add(label);
    return { label, centroid: c.centroid, size: c.assetIds.length, assetIds: c.assetIds };
  });

  return { update, insert, deleteIds: deleteIds.sort(), retainIds: retainIds.sort() };
}
