import { UNSORTED_CLOUD_KEY } from "./layout";

/** Derives each asset's Topic-view cloud from its AI tags (ADR 0023) — the
 *  interim replacement for the inert `group: "archive"` default, until a real
 *  clustering job over embeddings owns this field (spec §13, post-MVP).
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
}

/** Thematic categories, most to least topical. `place` belongs to the Map
 *  view, `attribute` describes people not themes, `other` is too vague. */
export const TOPIC_CATEGORY_PRIORITY = ["event", "scene", "object"] as const;

/** A tag carried by more than this share of the tagged assets names the whole
 *  archive, not a theme inside it — skipped as a topic candidate. */
export const TOPIC_AMBIENT_FRACTION = 0.6;

/** At most this many named topic clouds; smaller topics fold into Other.
 *  Matches the 6-color cloud palette so named topics get distinct colors. */
export const TOPIC_CLOUD_CAP = 6;

/** Tagged assets whose tags yield no viable topic. Capitalized on purpose:
 *  Gemini tags are lowercase, so this can never collide with a real tag. */
export const TOPIC_OTHER_KEY = "Other";

const countKey = (t: TopicTag) => `${t.category}:${t.name}`;

/**
 * Assigns every asset a topic cloud key:
 * - untagged (unanalyzed) → Unsorted;
 * - otherwise the asset's most *clustering-useful* tag: walk the category
 *   priority, and within the first category that has any viable tag pick the
 *   one shared with the most other assets (ambient tags excluded), name
 *   tie-break;
 * - no viable tag in any thematic category → Other;
 * - finally only the TOPIC_CLOUD_CAP biggest topics keep their name — the
 *   rest fold into Other so the canvas stays readable.
 */
export function deriveTopics(assets: readonly TopicAsset[]): Map<string, string> {
  const topics = new Map<string, string>();

  // Distinct-asset count per (category, name) — a duplicated name on one
  // asset (same name under two categories is two DB rows) must not double.
  const counts = new Map<string, number>();
  let taggedCount = 0;
  for (const asset of assets) {
    if (asset.tags.length === 0) continue;
    taggedCount += 1;
    for (const key of new Set(asset.tags.map(countKey))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const ambientMax = Math.max(2, Math.round(taggedCount * TOPIC_AMBIENT_FRACTION));

  for (const asset of assets) {
    if (asset.tags.length === 0) {
      topics.set(asset.id, UNSORTED_CLOUD_KEY);
      continue;
    }
    let topic = TOPIC_OTHER_KEY;
    for (const category of TOPIC_CATEGORY_PRIORITY) {
      const viable = asset.tags
        .filter((t) => t.category === category)
        .map((t) => ({ name: t.name, count: counts.get(countKey(t)) ?? 0 }))
        .filter((t) => t.count <= ambientMax);
      if (viable.length === 0) continue;
      viable.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
      topic = viable[0].name;
      break;
    }
    topics.set(asset.id, topic);
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
