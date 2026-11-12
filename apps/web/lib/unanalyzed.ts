import type { Photo } from "@/types";
import { isRealSource } from "./img";

/** What AI analysis could do with a photo right now — the ONE rule both
 *  "Analyze N" offers share: the upload pill's `analyzableUploadIds`
 *  (lib/upload-pill) and the AI panel intro's `unanalyzedInScope` below.
 *
 *  - `processed`: already analyzed (`ai_processed_at` set).
 *  - `pending`: no preview yet (`src` is presigned only once a thumb exists).
 *    The worker's analyze handler SKIPS an asset with no medium preview and
 *    still reports the job done, so offering one would sell work that never
 *    happens.
 *  - `ready`: can be analyzed. */
export type AnalyzeReadiness = "processed" | "pending" | "ready";

export function analyzeReadiness(photo: Pick<Photo, "src" | "processed">): AnalyzeReadiness {
  if (photo.processed) return "processed";
  return photo.src ? "ready" : "pending";
}

export interface UnanalyzedScope {
  /** Exactly what the intro's "Select N unanalyzed" selects, in input order. */
  ids: string[];
  /** Ready but not drawn — inside a collapsed folder. Counted, never selected. */
  hidden: number;
  /** Not analyzed and no preview yet. Counted, never selected. */
  pending: number;
  /** Real photos in scope, analyzed or not (mock rows excluded). */
  total: number;
}

/** The unanalyzed photos the AI panel's no-selection intro offers.
 *
 *  `photos` is the scope-and-filter set (`ws.visiblePhotos`: Workspace scope +
 *  label filter). `drawn` is what the canvas draws — `ws.activePositions`, or
 *  null when the view draws every photo it is given (only the Canvas view
 *  hides collapsed-folder members). A hidden tile is never selected: the same
 *  rule as the marquee and `ungroupFolder` (ADR 0040 — what you cannot see you
 *  cannot act on). Photos already in a running job (`busy`) are skipped
 *  outright. Mock rows are not part of the archive and are ignored, like the
 *  tile badge ignores them. Deterministic: input order is kept. */
export function unanalyzedInScope(
  photos: readonly Photo[],
  drawn: Readonly<Record<string, unknown>> | ReadonlySet<string> | null,
  busy: ReadonlySet<string>,
): UnanalyzedScope {
  const isDrawn = (id: string): boolean =>
    drawn === null
      ? true
      : drawn instanceof Set
        ? drawn.has(id)
        : Object.prototype.hasOwnProperty.call(drawn, id);
  const out: UnanalyzedScope = { ids: [], hidden: 0, pending: 0, total: 0 };
  for (const photo of photos) {
    if (!isRealSource(photo.source)) continue;
    out.total += 1;
    const readiness = analyzeReadiness(photo);
    if (readiness === "processed") continue;
    if (busy.has(photo.id)) continue;
    if (readiness === "pending") out.pending += 1;
    else if (!isDrawn(photo.id)) out.hidden += 1;
    else out.ids.push(photo.id);
  }
  return out;
}
