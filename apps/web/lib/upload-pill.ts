import type { CanvasUploadPreview, Photo } from "@/types";

/** The upload summary pill's policy: when it closes itself, when it may offer
 *  "Analyze N with AI", and where it docks. Pure and React-free so the rules
 *  are unit-tested (`upload-pill.test.ts`); `UploadManager` only wires them. */

/** A clean batch with nothing to offer: read it and get out of the way. */
export const UPLOAD_PILL_SUCCESS_MS = 4000;
/** A clean batch carrying the call to action needs time to decide and click. */
export const UPLOAD_PILL_CTA_MS = 8000;
/** Cap on "Preparing previews": a missed Realtime event must not pin the pill
 *  forever. Past it the pill closes without the CTA — the canvas's own AI
 *  button still reaches those photos. */
export const UPLOAD_PILL_PREPARE_MAX_MS = 60_000;
/** Space between the pill and the bottom chrome it docks above. */
export const UPLOAD_PILL_DOCK_GAP = 10;
/** A chrome element whose top leaves less room than this above it (a tall
 *  BulkAiPanel) is not docked above: the pill sits under it instead, and the
 *  control wins by z (`Z.uploadPill` is below every canvas bar and panel). */
export const UPLOAD_PILL_MIN_ROOM = 160;

export type UploadPillDismiss =
  /** Upload or finalize still in flight — never auto-hides. */
  | { kind: "none" }
  /** Failures, skips, project-link failures or errors — stays until closed. */
  | { kind: "sticky" }
  /** Clean, but some uploaded photos are still ingesting. */
  | { kind: "wait" }
  | { kind: "auto"; ms: number };

export function uploadPillDismiss(input: {
  done: boolean;
  failedCount: number;
  skippedCount: number;
  linkFailedCount: number;
  errorCount: number;
  pending: number;
  analyzableCount: number;
}): UploadPillDismiss {
  if (!input.done) return { kind: "none" };
  // Anything that needs reading or a Retry must not vanish on a timer.
  if (
    input.failedCount > 0
    || input.skippedCount > 0
    || input.linkFailedCount > 0
    || input.errorCount > 0
  ) {
    return { kind: "sticky" };
  }
  if (input.pending > 0) return { kind: "wait" };
  return {
    kind: "auto",
    ms: input.analyzableCount > 0 ? UPLOAD_PILL_CTA_MS : UPLOAD_PILL_SUCCESS_MS,
  };
}

type AnalyzablePhoto = Pick<Photo, "id" | "src" | "processed">;

/** Uploaded ids that are on this canvas, have a preview and still need
 *  analysis — deduped, upload order kept.
 *
 *  - On this canvas: `photos` is whatever the caller shows (Workspace scope and
 *    label filter applied), so a hidden tile is never offered or selected. An
 *    id ingest merged into an existing asset (dedup deletes the uploaded row)
 *    is simply absent and drops out.
 *  - Has a preview (`src`): the worker's analyze handler silently SKIPS an asset
 *    with no medium preview and still reports the job done, so offering one
 *    early would sell work that never happens. */
export function analyzableUploadIds(
  ids: readonly string[],
  photos: readonly AnalyzablePhoto[],
): string[] {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const photo = byId.get(id);
    if (photo && photo.src && !photo.processed) out.push(id);
  }
  return out;
}

export interface UploadAnalyzeStatus {
  /** Uploaded ids whose canvas preview is still uploading or ingesting. */
  pending: number;
  /** `analyzableUploadIds` of the rest. */
  analyzable: string[];
}

/** Readiness of a just-uploaded batch. An id with an upload preview still in
 *  "uploading"/"processing" is not analyzable yet, even when a photo row for it
 *  already exists — the preview tile is what tracks ingest on the client. */
export function uploadAnalyzeStatus(
  ids: readonly string[],
  photos: readonly AnalyzablePhoto[],
  previews: readonly Pick<CanvasUploadPreview, "assetId" | "stage">[],
): UploadAnalyzeStatus {
  const inFlight = new Set<string>();
  for (const preview of previews) {
    if (preview.assetId && (preview.stage === "uploading" || preview.stage === "processing")) {
      inFlight.add(preview.assetId);
    }
  }
  const unique = Array.from(new Set(ids));
  const pending = unique.filter((id) => inFlight.has(id)).length;
  const ready = unique.filter((id) => !inFlight.has(id));
  return { pending, analyzable: analyzableUploadIds(ready, photos) };
}

/** `bottom` (px) that docks the pill `gap` above the highest bottom chrome
 *  that still leaves `minRoom` above it; null → the caller's fallback. Tops at
 *  or below the viewport's bottom edge (or not finite) are ignored. */
export function dockBottomFor(
  viewportHeight: number,
  chromeTops: readonly number[],
  gap: number = UPLOAD_PILL_DOCK_GAP,
  minRoom: number = UPLOAD_PILL_MIN_ROOM,
): number | null {
  const usable = chromeTops.filter(
    (top) => Number.isFinite(top) && top < viewportHeight && top - gap >= minRoom,
  );
  if (usable.length === 0) return null;
  return Math.round(viewportHeight - Math.min(...usable) + gap);
}
