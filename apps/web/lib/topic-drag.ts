import type { CloudLayout, CloudNode } from "./layout";

/** Topic membership is changed only by an intentional drop onto another
 * persisted cloud's core/label. Heuristic clouds are not targets: materialising
 * one would silently pin unselected members, while assigning only the dragged
 * files would split it into two same-named clouds. “New topic from selection”
 * is the explicit, consent-preserving path. The blurred blob is deliberately
 * NOT the hit target because it extends far beyond the files. */
const CORE_PAD = 22;
const LABEL_HEIGHT = 44;
const LABEL_MIN_HALF_WIDTH = 64;

export interface TopicDropPoint {
  x: number;
  y: number;
}

/** Only a completed release authorises the server mutation. Browsers dispatch
 * pointercancel through the same cleanup path when the OS takes a gesture;
 * treating that as a drop would turn interruption into a workspace-wide edit. */
export function committedTopicDropKey(eventType: string, armedKey: string | null): string | null {
  return eventType === "pointerup" ? armedKey : null;
}

interface Candidate {
  cloud: CloudNode;
  labelHit: boolean;
  distance: number;
}

/** Pick the one cloud a Topic tile drag is intentionally targeting.
 *
 * - A selection already wholly inside a cloud cannot target that same cloud;
 *   dragging inside it keeps its existing positional meaning.
 * - Labels win over core bboxes when clouds overlap.
 * - The nearest label wins deterministic ties between overlapping cores. */
export function topicDropTargetAt(
  layout: CloudLayout,
  point: TopicDropPoint,
  draggedIds: readonly string[],
): CloudNode | null {
  const candidates: Candidate[] = [];

  for (const cloud of layout.clouds) {
    if (!cloud.clusterId) continue;
    if (draggedIds.length > 0 && draggedIds.every((id) => layout.tileCloud[id] === cloud.key)) continue;

    const labelHalfWidth = Math.max(LABEL_MIN_HALF_WIDTH, cloud.label.length * 5.5 + 18);
    const labelHit =
      point.x >= cloud.labelX - labelHalfWidth &&
      point.x <= cloud.labelX + labelHalfWidth &&
      point.y >= cloud.labelY - LABEL_HEIGHT &&
      point.y <= cloud.labelY + 8;
    const coreHit =
      point.x >= cloud.bx - CORE_PAD &&
      point.x <= cloud.bx + cloud.bw + CORE_PAD &&
      point.y >= cloud.by - CORE_PAD &&
      point.y <= cloud.by + cloud.bh + CORE_PAD;
    if (!labelHit && !coreHit) continue;

    candidates.push({
      cloud,
      labelHit,
      distance: Math.hypot(point.x - cloud.labelX, point.y - cloud.labelY),
    });
  }

  candidates.sort(
    (a, b) => Number(b.labelHit) - Number(a.labelHit) || a.distance - b.distance || a.cloud.key.localeCompare(b.cloud.key),
  );
  return candidates[0]?.cloud ?? null;
}
