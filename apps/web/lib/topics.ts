import { UNSORTED_CLOUD_KEY } from "./layout";

/** Derives each asset's Topic-view cloud.
 *
 *  Primary source is the STORED semantic cluster label (topic_clusters.label,
 *  ADR 0028): a worker k-means job groups "yoga"/"stretching"/"йога" into one
 *  cloud, stable across sessions and identical in every project. When an asset
 *  has no cluster yet (not analyzed, or clustered before it was added), this
 *  falls back to the tag heuristic (ADR 0023 — event→scene→object priority,
 *  ambient-tag skipping, top-6 + Other). Untagged AND unclustered → Unsorted.
 *
 *  Pure and deterministic: same rows in, same topics out, regardless of row
 *  order — safe for SSR + client re-render (the no-Math.random layout rule). */

export interface TopicTag {
  name: string;
  category: string;
}

export interface TopicAsset {
  id: string;
  tags: readonly TopicTag[];
  /** Stored cluster label (ADR 0028) — wins over the tag heuristic when set.
   *  Absent/null/empty means not-yet-clustered → fall back to tags. */
  clusterLabel?: string | null;
}

/** Thematic categories, most to least topical. `place` belongs to the Map
 *  view, `attribute` describes people not themes, `other` is too vague. */
export const TOPIC_CATEGORY_PRIORITY = ["event", "scene", "object"] as const;

/** A tag carried by more than this share of the tagged assets names the whole
 *  archive, not a theme inside it — skipped while the asset has any more
 *  specific alternative. Assets whose only thematic tags are ambient keep the
 *  ambient tag rather than falling to Other, so a tiny archive sharing one
 *  tag still gets a named cloud instead of renaming itself to "Other" on the
 *  third upload. */
export const TOPIC_AMBIENT_FRACTION = 0.6;

/** At most this many named topic clouds; smaller topics fold into Other so
 *  the canvas stays readable. (Colors come from the shared hash palette and
 *  CAN collide between clouds — the cap bounds cloud count, not colors.) */
export const TOPIC_CLOUD_CAP = 6;

/** Tagged assets whose tags yield no viable topic. Capitalized on purpose:
 *  Gemini tags are lowercase, so this can never collide with a real tag. */
export const TOPIC_OTHER_KEY = "Other";

/**
 * Assigns every asset a topic cloud key:
 * - a stored cluster label (ADR 0028) wins outright, even for a tagless asset;
 * - else untagged (unanalyzed) → Unsorted;
 * - otherwise the asset's most *clustering-useful* tag: walk the category
 *   priority, and within the first category that has any viable tag pick the
 *   one shared with the most other assets (ambient tags excluded), name
 *   tie-break;
 * - if every thematic tag the asset has is ambient, re-walk allowing them —
 *   the asset keeps its ambient tag instead of falling to Other;
 * - no tag in any thematic category at all → Other;
 * - finally only the TOPIC_CLOUD_CAP biggest topics keep their name — the
 *   rest fold into Other so the canvas stays readable. Cluster labels and
 *   heuristic topics fold together into one combined set.
 */
export function deriveTopics(assets: readonly TopicAsset[]): Map<string, string> {
  const topics = new Map<string, string>();

  // Distinct-asset count per tag NAME. Names merge across categories on
  // purpose: re-analyze can drift a tag's category (the DB unique key is
  // name+category), and counting the halves separately would let an ambient
  // name sneak under the threshold. The per-asset Set also keeps a name
  // carried under two categories from counting its asset twice.
  const counts = new Map<string, number>();
  let taggedCount = 0;
  for (const asset of assets) {
    if (asset.tags.length === 0) continue;
    taggedCount += 1;
    for (const name of new Set(asset.tags.map((t) => t.name))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  // floor, not round: a tag on strictly more than the fraction is ambient
  // (round would let 4-of-6 = 67% pass a 60% threshold).
  const ambientMax = Math.max(2, Math.floor(taggedCount * TOPIC_AMBIENT_FRACTION));

  for (const asset of assets) {
    // Stored cluster label wins outright — even for an asset with no tags.
    const clusterLabel = asset.clusterLabel?.trim();
    if (clusterLabel) {
      topics.set(asset.id, clusterLabel);
      continue;
    }
    if (asset.tags.length === 0) {
      topics.set(asset.id, UNSORTED_CLOUD_KEY);
      continue;
    }
    const pick = (allowAmbient: boolean): string | null => {
      for (const category of TOPIC_CATEGORY_PRIORITY) {
        const viable = asset.tags
          .filter((t) => t.category === category)
          .map((t) => ({ name: t.name, count: counts.get(t.name) ?? 0 }))
          .filter((t) => allowAmbient || t.count <= ambientMax);
        if (viable.length === 0) continue;
        viable.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
        return viable[0].name;
      }
      return null;
    };
    topics.set(asset.id, pick(false) ?? pick(true) ?? TOPIC_OTHER_KEY);
  }

  // Fold everything past the TOPIC_CLOUD_CAP biggest topics into Other
  // (size desc, name asc — deterministic under any input order).
  const sizes = new Map<string, number>();
  for (const topic of topics.values()) {
    if (topic === UNSORTED_CLOUD_KEY || topic === TOPIC_OTHER_KEY) continue;
    sizes.set(topic, (sizes.get(topic) ?? 0) + 1);
  }
  const keep = new Set(
    [...sizes.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, TOPIC_CLOUD_CAP)
      .map(([name]) => name),
  );
  for (const [id, topic] of topics) {
    if (topic !== UNSORTED_CLOUD_KEY && topic !== TOPIC_OTHER_KEY && !keep.has(topic)) {
      topics.set(id, TOPIC_OTHER_KEY);
    }
  }
  return topics;
}
