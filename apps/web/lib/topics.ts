/** Derives each asset's Topic-view identity and display label.
 *
 *  The machine-owned baseline is either a stored embedding cluster (ADR 0028)
 *  or the tag heuristic (ADR 0023). A user assignment is a separate override:
 *  it wins for the effective topic without erasing the baseline, so "Return to
 *  AI" can restore the exact topic locally before the next server refresh.
 *
 *  Identity is deliberately separate from the renameable label. Stored topics
 *  use their cluster UUID; heuristic/system topics get namespaced synthetic
 *  keys. Pure and deterministic: same rows in, same assignments out, regardless
 *  of row order — safe for SSR + client re-render. */

/** Display label for assets that have neither a stored cluster nor useful tags. */
export const UNSORTED_CLOUD_KEY = "Unsorted";

/** Tagged assets whose tags yield no viable topic. Capitalized on purpose:
 *  Gemini tags are lowercase, so this cannot collide with a real tag label. */
export const TOPIC_OTHER_KEY = "Other";

const HEURISTIC_TOPIC_PREFIX = "heuristic:";
const SYSTEM_TOPIC_PREFIX = "system:";

/** Stable cloud key for a stored topic. Keeping the raw UUID is intentional:
 *  ADR 0038 drag overrides already persist that value in localStorage, so a
 *  prefix would make every existing arrangement look stale. */
export function clusterTopicKey(clusterId: string): string {
  return clusterId;
}

/** Stable synthetic key for a tag-derived/system topic. Labels are the source
 *  of identity only on this fallback path; stored cluster labels never enter
 *  it, so a human rename cannot change a cloud key or color. */
export function heuristicTopicKey(label: string): string {
  if (label === UNSORTED_CLOUD_KEY) return `${SYSTEM_TOPIC_PREFIX}unsorted`;
  if (label === TOPIC_OTHER_KEY) return `${SYSTEM_TOPIC_PREFIX}other`;
  return `${HEURISTIC_TOPIC_PREFIX}${label}`;
}

export interface TopicTag {
  name: string;
  category: string;
}

export interface TopicAsset {
  id: string;
  tags: readonly TopicTag[];
  /** Machine-owned k-means membership (`assets.cluster_id`). */
  autoClusterId?: string | null;
  /** Display label joined through `assets.cluster_id`. */
  autoClusterLabel?: string | null;
  /** User-owned effective membership (`topic_cluster_overrides.cluster_id`). */
  manualClusterId?: string | null;
  /** Display label joined through the manual override's target cluster. */
  manualClusterLabel?: string | null;
  /** Backward-compatible input for focused ADR 0028 tests/callers. New reads
   *  should pass `autoClusterId` + `autoClusterLabel` together. */
  clusterLabel?: string | null;
}

/** Full Topic read model for one asset. `topicId` is null only on the
 *  heuristic/system path; `topicKey` is always stable and layout-safe. */
export interface TopicAssignment {
  autoClusterId: string | null;
  manualClusterId: string | null;
  autoTopicKey: string;
  autoTopicLabel: string;
  topicId: string | null;
  topicKey: string;
  label: string;
}

/** Thematic categories, most to least topical. `place` belongs to the Map
 *  view, `attribute` describes people not themes, `other` is too vague. */
export const TOPIC_CATEGORY_PRIORITY = ["event", "scene", "object"] as const;

/** A tag carried by more than this share of the tagged assets names the whole
 *  archive, not a theme inside it — skipped while the asset has any more
 *  specific alternative. */
export const TOPIC_AMBIENT_FRACTION = 0.6;

/** At most this many named topics derived from tags. Stored auto/manual
 *  clusters are already bounded by the worker and never enter this cap. */
export const TOPIC_CLOUD_CAP = 6;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Derive the tag-based baseline labels only for assets that do not have a
 *  stored auto cluster. Tag frequencies still use the whole result set, as in
 *  ADR 0023; manual overrides do not remove an asset from its AI baseline. */
function deriveHeuristicLabels(assets: readonly TopicAsset[]): Map<string, string> {
  const labels = new Map<string, string>();

  // Distinct-asset count per tag NAME. Names merge across categories on
  // purpose: re-analyze can drift a tag's category, and the per-asset Set keeps
  // one name carried under two categories from counting its asset twice.
  const counts = new Map<string, number>();
  let taggedCount = 0;
  for (const asset of assets) {
    if (asset.tags.length === 0) continue;
    taggedCount += 1;
    for (const name of new Set(asset.tags.map((tag) => tag.name))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  // Floor, not round: a tag on strictly more than the fraction is ambient.
  const ambientMax = Math.max(2, Math.floor(taggedCount * TOPIC_AMBIENT_FRACTION));

  for (const asset of assets) {
    // A stored label without an id is supported only for the legacy
    // `clusterLabel` input. It is still a stored topic, not a heuristic one.
    if (clean(asset.autoClusterId) || clean(asset.autoClusterLabel ?? asset.clusterLabel)) continue;
    if (asset.tags.length === 0) {
      labels.set(asset.id, UNSORTED_CLOUD_KEY);
      continue;
    }
    const pick = (allowAmbient: boolean): string | null => {
      for (const category of TOPIC_CATEGORY_PRIORITY) {
        const viable = asset.tags
          .filter((tag) => tag.category === category)
          .map((tag) => ({ name: tag.name, count: counts.get(tag.name) ?? 0 }))
          .filter((tag) => allowAmbient || tag.count <= ambientMax);
        if (viable.length === 0) continue;
        viable.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return viable[0].name;
      }
      return null;
    };
    labels.set(asset.id, pick(false) ?? pick(true) ?? TOPIC_OTHER_KEY);
  }

  // Fold everything past the cap into Other (size desc, name asc). This pass
  // covers the AUTO fallback even for manually-overridden assets, so Return to
  // AI restores the same baseline the server would derive after a refresh.
  const sizes = new Map<string, number>();
  for (const label of labels.values()) {
    if (label === UNSORTED_CLOUD_KEY || label === TOPIC_OTHER_KEY) continue;
    sizes.set(label, (sizes.get(label) ?? 0) + 1);
  }
  const keep = new Set(
    [...sizes.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, TOPIC_CLOUD_CAP)
      .map(([label]) => label),
  );
  for (const [id, label] of labels) {
    if (label !== UNSORTED_CLOUD_KEY && label !== TOPIC_OTHER_KEY && !keep.has(label)) {
      labels.set(id, TOPIC_OTHER_KEY);
    }
  }
  return labels;
}

/** Computes both the machine baseline and the effective manual-first topic. */
export function deriveTopicAssignments(assets: readonly TopicAsset[]): Map<string, TopicAssignment> {
  const heuristicLabels = deriveHeuristicLabels(assets);
  const assignments = new Map<string, TopicAssignment>();

  for (const asset of assets) {
    const autoClusterId = clean(asset.autoClusterId);
    const storedAutoLabel = clean(asset.autoClusterLabel ?? asset.clusterLabel);

    // A real cluster id is identity even if its joined label is unexpectedly
    // unavailable (RLS/schema-cache race). One neutral label keeps all members
    // together rather than splitting the same UUID by per-asset tag guesses.
    const autoTopicLabel = autoClusterId
      ? (storedAutoLabel ?? "Untitled topic")
      : (storedAutoLabel ?? heuristicLabels.get(asset.id) ?? UNSORTED_CLOUD_KEY);
    const autoTopicKey = autoClusterId
      ? clusterTopicKey(autoClusterId)
      : storedAutoLabel
        ? `${SYSTEM_TOPIC_PREFIX}stored-label:${storedAutoLabel}`
        : heuristicTopicKey(autoTopicLabel);

    const manualClusterId = clean(asset.manualClusterId);
    const manualLabel = clean(asset.manualClusterLabel);
    const topicId = manualClusterId ?? autoClusterId;
    const label = manualClusterId ? (manualLabel ?? "Untitled topic") : autoTopicLabel;
    const topicKey = topicId ? clusterTopicKey(topicId) : autoTopicKey;

    assignments.set(asset.id, {
      autoClusterId,
      manualClusterId,
      autoTopicKey,
      autoTopicLabel,
      topicId,
      topicKey,
      label,
    });
  }
  return assignments;
}

/** Compatibility projection used by existing topic-label callers/tests. New
 *  read-model code should consume `deriveTopicAssignments` so identity is not
 *  thrown away. */
export function deriveTopics(assets: readonly TopicAsset[]): Map<string, string> {
  return new Map([...deriveTopicAssignments(assets)].map(([id, assignment]) => [id, assignment.label]));
}
