"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseIcon, SparkleIcon } from "@/components/icons/icons";
import { useSmoothProgress } from "@/hooks/useSmoothProgress";
import {
  createUploadBatchId,
  retryProjectLinks,
  runUpload,
  uploadCandidates,
  type UploadProgress,
  type UploadStage,
} from "@/lib/upload-client";
import { BOTTOM_CHROME_EVENT, Z } from "@/lib/ui";
import {
  UPLOAD_PILL_PREPARE_MAX_MS,
  UPLOAD_PILL_MAX_WIDTH,
  UPLOAD_PILL_SIDE_INSET,
  dockBottomFor,
  underUploadPill,
  uploadPillDismiss,
  uploadPillHeld,
  type UploadAnalyzeStatus,
} from "@/lib/upload-pill";
import type {
  CanvasPoint,
  IndexedUploadFile,
  UploadedFileResult,
  UploadSkipReason,
  UploadBatchResult,
  UploadBatchStart,
  UploadResult,
} from "@/types";

/** Window-level drag-and-drop upload (journey step 1: direct local upload).
 *  Self-contained on purpose — listens on window, shows its own overlay +
 *  progress pill, delegates to lib/upload-client (shared with ImportModal).
 *  `projectId` links uploaded assets into the current project (#17). */

interface UploadManagerProps {
  projectId: string;
  /** The project import modal owns drag/drop while open. */
  disabled?: boolean;
  /** Optional guidance when this instance is only guarding against native file navigation. */
  disabledMessage?: string;
  onBatchStart?: (batch: UploadBatchStart) => void;
  onBatchSettled?: (result: UploadBatchResult) => void;
  /** Readiness of just-uploaded ids on this canvas (ArchiveWorkspace derives it
   *  from photos + upload previews, lib/upload-pill). Absent → no AI call to
   *  action. */
  analyzeStatus?: (assetIds: readonly string[]) => UploadAnalyzeStatus;
  /** Select these ids and open BulkAiPanel. Never runs AI. false = could not
   *  open (the pill stays). */
  onAnalyzeUploaded?: (assetIds: string[]) => boolean;
  /** Changes whenever the set of bottom chrome can change; absent → no docking
   *  (the pill keeps its fallback bottom). */
  dockKey?: string;
}

interface PillState {
  active: boolean;
  totalFiles: number;
  doneFiles: number;
  progress: number;
  stage: UploadStage;
  summary: UploadSummary | null;
  errors: string[];
  hiddenErrorCount: number;
}

interface LinkRetry {
  file: IndexedUploadFile;
  uploaded: UploadedFileResult;
}

interface UploadSummary {
  /** Bumped on every settle (first upload and each retry), so the dismiss
   *  timer and the hover/focus hold start fresh for each summary. */
  seq: number;
  batchId: string;
  projectId: string;
  clientPoint: CanvasPoint;
  uploadedCount: number;
  skippedCount: number;
  skippedReasons: Record<UploadSkipReason, number>;
  retryFiles: IndexedUploadFile[];
  retryLinks: LinkRetry[];
  /** Every asset id this batch uploaded, retries included — what the
   *  "Analyze N with AI" call to action is computed over. */
  assetIds: string[];
}

const MAX_VISIBLE_ERRORS = 3;
const EMPTY_SKIP_COUNTS: Record<UploadSkipReason, number> = {
  empty: 0,
  "too-large": 0,
  "batch-limit": 0,
};
const IDLE: PillState = {
  active: false,
  totalFiles: 0,
  doneFiles: 0,
  progress: 0,
  stage: "uploading",
  summary: null,
  errors: [],
  hiddenErrorCount: 0,
};

function boundedErrors(errors: readonly string[]): Pick<PillState, "errors" | "hiddenErrorCount"> {
  const unique = Array.from(new Set(errors));
  return {
    errors: unique.slice(0, MAX_VISIBLE_ERRORS),
    hiddenErrorCount: Math.max(0, unique.length - MAX_VISIBLE_ERRORS),
  };
}

function mergeSkipCounts(
  previous: Record<UploadSkipReason, number>,
  result: UploadResult,
): Record<UploadSkipReason, number> {
  const next = { ...previous };
  for (const skipped of result.skippedFiles) next[skipped.reason] += 1;
  return next;
}

function emptyUploadResult(): UploadResult {
  return {
    attemptedIndexes: [],
    assetIds: [],
    uploaded: [],
    failedIndexes: [],
    skippedIndexes: [],
    skippedFiles: [],
    jobIds: [],
    projectLink: "not-requested",
    projectLinkFailedIndexes: [],
    errors: [],
    skipped: 0,
  };
}

function failedUploadResult(indexes: number[], message: string): UploadResult {
  return {
    ...emptyUploadResult(),
    attemptedIndexes: indexes,
    failedIndexes: indexes,
    errors: [message],
  };
}

function retryFilesFor(
  files: readonly IndexedUploadFile[],
  result: UploadResult,
): IndexedUploadFile[] {
  const failed = new Set(result.failedIndexes);
  return files.filter((item) => failed.has(item.inputIndex));
}

function linkRetriesFor(
  files: readonly IndexedUploadFile[],
  result: UploadResult,
): LinkRetry[] {
  const filesByIndex = new Map(files.map((item) => [item.inputIndex, item]));
  const uploadedByIndex = new Map(result.uploaded.map((item) => [item.inputIndex, item]));
  return result.projectLinkFailedIndexes.flatMap((inputIndex): LinkRetry[] => {
    const file = filesByIndex.get(inputIndex);
    const uploaded = uploadedByIndex.get(inputIndex);
    return file && uploaded ? [{ file, uploaded }] : [];
  });
}

/** Fires `onDismiss` after `ms`, pausing (not restarting) while `paused`.
 *  A new `token` or `ms` starts a fresh countdown; `ms === null` clears it.
 *  The effect cleanup also covers unmount. */
function useAutoDismiss(
  ms: number | null,
  paused: boolean,
  token: string,
  onDismiss: () => void,
) {
  const remaining = useRef<number | null>(null);
  const forKey = useRef<string | null>(null);
  const callback = useRef(onDismiss);
  useEffect(() => {
    callback.current = onDismiss;
  });
  useEffect(() => {
    const key = `${token}|${ms}`;
    if (forKey.current !== key) {
      forKey.current = key;
      remaining.current = ms;
    }
    if (ms === null || paused || remaining.current === null) return;
    const started = Date.now();
    const timer = window.setTimeout(() => {
      remaining.current = 0;
      callback.current();
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (remaining.current !== null) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - started));
      }
    };
  }, [ms, paused, token]);
}

/** Announced, never shown (ExportDialog's idiom: no Tailwind utilities in
 *  components, so no `sr-only` class). */
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** The bottom chrome the pill docks above. These class hooks are carried by
 *  ViewSwitcher (`am-viewswitcher`), SortingActionBar and WorkspaceActionBar
 *  (`am-bar`), BulkAiPanel (`am-bulk-ai`) and the Map's photos-at-this-spot
 *  stack (`am-map-stack`) — renaming one drops the pill back to its fallback
 *  bottom, under the bars, where they win by z. The Map stack is the exception
 *  to that: the Map pane is its own stacking context at z 5, so nothing but
 *  docking keeps the pill off it (Z.uploadPill). */
const CHROME_SELECTOR = ".am-viewswitcher, .am-bar, .am-bulk-ai, .am-map-stack";

/** Measured, not computed from props: the bars wrap at 760 px and below, are
 *  52 px strips on a coarse pointer, and BulkAiPanel's height follows its
 *  content. Re-queried when `dockKey` changes (ArchiveWorkspace re-renders
 *  on every pan frame) and on BOTTOM_CHROME_EVENT (chrome that mounts on its
 *  own), re-measured by ResizeObserver and window resize. Only chrome that can
 *  sit under the pill horizontally counts (`underUploadPill`). */
function useDockBottom(active: boolean, dockKey: string | undefined): number | null {
  const [bottom, setBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active || dockKey === undefined) return;
    let els: HTMLElement[] = [];
    const measure = () => setBottom(dockBottomFor(
      window.innerHeight,
      els
        .map((el) => el.getBoundingClientRect())
        .filter((rect) => rect.height > 0 && underUploadPill(window.innerWidth, rect))
        .map((rect) => rect.top),
    ));
    // ResizeObserver's initial observation does the first measure, so there is
    // no synchronous setState in this effect body.
    const observer = new ResizeObserver(measure);
    let frame = 0;
    const query = () => {
      observer.disconnect();
      els = Array.from(document.querySelectorAll<HTMLElement>(CHROME_SELECTOR));
      for (const el of els) observer.observe(el);
      if (frame) cancelAnimationFrame(frame);
      frame = els.length === 0 ? requestAnimationFrame(() => setBottom(null)) : 0;
    };
    query();
    window.addEventListener("resize", measure);
    window.addEventListener(BOTTOM_CHROME_EVENT, query);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener(BOTTOM_CHROME_EVENT, query);
    };
  }, [active, dockKey]);
  return active && dockKey !== undefined ? bottom : null;
}

export default function UploadManager({
  projectId,
  disabled = false,
  disabledMessage,
  onBatchStart,
  onBatchSettled,
  analyzeStatus,
  onAnalyzeUploaded,
  dockKey,
}: UploadManagerProps) {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [pill, setPill] = useState<PillState>(IDLE);
  const dragDepth = useRef(0);
  const busy = useRef(false);
  const settleSeq = useRef(0);

  const upload = useCallback(
    async (files: File[], clientPoint: CanvasPoint) => {
      if (disabled || busy.current || files.length === 0) return;
      busy.current = true;
      const id = createUploadBatchId();
      const candidates = uploadCandidates(files);
      setPill({ ...IDLE, active: true });
      if (candidates.length > 0) {
        onBatchStart?.({ batchId: id, origin: "canvas-drop", clientPoint, files: candidates });
      }
      const onProgress = (p: UploadProgress) =>
        setPill((prev) => ({ ...prev, active: true, ...p }));
      let result: UploadResult;
      try {
        result = await runUpload(files, { batchId: id, projectId, onProgress });
      } catch (error) {
        result = failedUploadResult(
          candidates.map((item) => item.inputIndex),
          error instanceof Error ? error.message : "Upload failed",
        );
      } finally {
        busy.current = false;
      }

      if (candidates.length > 0) onBatchSettled?.({ batchId: id, ...result });
      if (result.assetIds.length > 0) router.refresh();
      const seq = ++settleSeq.current;
      setPill((prev) => ({
        ...prev,
        active: true,
        progress: 1,
        stage: "done",
        summary: {
          seq,
          batchId: id,
          projectId,
          clientPoint,
          uploadedCount: result.uploaded.length,
          skippedCount: result.skipped,
          skippedReasons: mergeSkipCounts(EMPTY_SKIP_COUNTS, result),
          retryFiles: retryFilesFor(candidates, result),
          retryLinks: linkRetriesFor(candidates, result),
          assetIds: result.uploaded.map((u) => u.assetId),
        },
        ...boundedErrors(result.errors),
      }));
    },
    [disabled, onBatchSettled, onBatchStart, projectId, router],
  );

  const retryFailed = useCallback(async () => {
    const previous = pill.summary;
    if (!previous || busy.current) return;
    const retryInputs = [
      ...previous.retryFiles,
      ...previous.retryLinks.map((item) => item.file),
    ];
    if (retryInputs.length === 0) return;

    busy.current = true;
    onBatchStart?.({
      batchId: previous.batchId,
      origin: "canvas-drop",
      clientPoint: previous.clientPoint,
      files: retryInputs,
    });
    setPill((current) => ({
      ...current,
      active: true,
      totalFiles: retryInputs.length,
      doneFiles: 0,
      progress: previous.retryFiles.length > 0 ? 0 : 0.96,
      stage: previous.retryFiles.length > 0 ? "uploading" : "finalizing",
      errors: [],
      hiddenErrorCount: 0,
    }));

    const uploadPromise = previous.retryFiles.length > 0
      ? runUpload(previous.retryFiles, {
        batchId: previous.batchId,
        projectId: previous.projectId,
        onProgress: (progress) => setPill((current) => ({
          ...current,
          ...progress,
          // The byte retry may finish while an independent link-only retry is
          // still running. Keep the summary in-flight until both settle.
          stage: progress.stage === "done" && previous.retryLinks.length > 0
            ? "finalizing"
            : progress.stage,
        })),
      }).catch((error) => failedUploadResult(
        previous.retryFiles.map((item) => item.inputIndex),
        error instanceof Error ? error.message : "Upload failed",
      ))
      : Promise.resolve(emptyUploadResult());
    const linkPromise = previous.retryLinks.length > 0
      ? retryProjectLinks(
        previous.retryLinks.map((item) => item.uploaded),
        { projectId: previous.projectId, batchId: previous.batchId },
      ).catch((error) => ({
        failedIndexes: previous.retryLinks.map((item) => item.file.inputIndex),
        errors: [error instanceof Error ? error.message : "add to project failed"],
      }))
      : Promise.resolve({ failedIndexes: [] as number[], errors: [] as string[] });

    const [uploadResult, linkResult] = await Promise.all([uploadPromise, linkPromise]);
    busy.current = false;

    const previousLinksByIndex = new Map(
      previous.retryLinks.map((item) => [item.file.inputIndex, item]),
    );
    const remainingPreviousLinks = linkResult.failedIndexes.flatMap((inputIndex): LinkRetry[] => {
      const retry = previousLinksByIndex.get(inputIndex);
      return retry ? [retry] : [];
    });
    const newLinkRetries = linkRetriesFor(previous.retryFiles, uploadResult);
    const retriedLinkUploads = previous.retryLinks.map((item) => item.uploaded);
    const linkFailedIndexes = Array.from(new Set([
      ...uploadResult.projectLinkFailedIndexes,
      ...linkResult.failedIndexes,
    ])).sort((a, b) => a - b);
    const combinedResult: UploadResult = {
      ...uploadResult,
      attemptedIndexes: Array.from(new Set([
        ...uploadResult.attemptedIndexes,
        ...retriedLinkUploads.map((item) => item.inputIndex),
      ])),
      assetIds: [...uploadResult.assetIds, ...retriedLinkUploads.map((item) => item.assetId)],
      uploaded: [...uploadResult.uploaded, ...retriedLinkUploads],
      jobIds: Array.from(new Set([
        ...uploadResult.jobIds,
        ...retriedLinkUploads.map((item) => item.jobId),
      ])),
      projectLink: previous.projectId === "all"
        ? "not-requested"
        : linkFailedIndexes.length > 0 ? "failed" : "linked",
      projectLinkFailedIndexes: linkFailedIndexes,
      errors: [...uploadResult.errors, ...linkResult.errors],
    };
    onBatchSettled?.({ batchId: previous.batchId, ...combinedResult });
    if (combinedResult.assetIds.length > 0) router.refresh();
    const seq = ++settleSeq.current;
    setPill((current) => ({
      ...current,
      active: true,
      progress: 1,
      stage: "done",
      summary: {
        ...previous,
        seq,
        uploadedCount: previous.uploadedCount + uploadResult.uploaded.length,
        skippedCount: previous.skippedCount + uploadResult.skipped,
        skippedReasons: mergeSkipCounts(previous.skippedReasons, uploadResult),
        retryFiles: retryFilesFor(previous.retryFiles, uploadResult),
        retryLinks: [...remainingPreviousLinks, ...newLinkRetries],
        // Retried link uploads are already in previous.assetIds.
        assetIds: Array.from(new Set([
          ...previous.assetIds,
          ...uploadResult.uploaded.map((u) => u.assetId),
        ])),
      },
      ...boundedErrors(combinedResult.errors),
    }));
  }, [onBatchSettled, onBatchStart, pill.summary, router]);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (disabled && !disabledMessage) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (disabled && !disabledMessage) {
        dragDepth.current = 0;
        return;
      }
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (disabled) return;
      void upload(
        Array.from(e.dataTransfer?.files ?? []),
        { x: e.clientX, y: e.clientY },
      );
    };
    const onDragEnd = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, [disabled, disabledMessage, upload]);

  useEffect(() => {
    if (!disabled) return;
    dragDepth.current = 0;
    const frame = requestAnimationFrame(() => setDragging(false));
    return () => cancelAnimationFrame(frame);
  }, [disabled]);

  const smooth = useSmoothProgress(pill.progress, pill.active);
  const pct = Math.round(smooth * 100);
  const summary = pill.summary;
  const failedCount = (summary?.retryFiles.length ?? 0) + (summary?.retryLinks.length ?? 0);
  const done = pill.stage === "done" && summary !== null;
  const status: UploadAnalyzeStatus = done && summary && analyzeStatus
    ? analyzeStatus(summary.assetIds)
    : { pending: 0, analyzable: [] };
  const policy = uploadPillDismiss({
    done,
    failedCount,
    skippedCount: summary?.skippedCount ?? 0,
    linkFailedCount: summary?.retryLinks.length ?? 0,
    errorCount: pill.errors.length + pill.hiddenErrorCount,
    pending: status.pending,
    // No handler → no call to action, so the plain-success timer applies.
    analyzableCount: onAnalyzeUploaded ? status.analyzable.length : 0,
  });
  const showCta = policy.kind === "auto" && status.analyzable.length > 0 && Boolean(onAnalyzeUploaded);
  const ctaCount = status.analyzable.length;
  const timerMs = policy.kind === "auto"
    ? policy.ms
    : policy.kind === "wait" ? UPLOAD_PILL_PREPARE_MAX_MS : null;

  // Pause while the pointer is over the pill or focus is inside it
  // (uploadPillHeld). Hover is tracked whatever the summary — a pointer that
  // is already resting on the pill when a batch or a retry settles fires no
  // new pointerenter — and cleared by closePill, because no pointerleave
  // fires after an unmount. Focus is keyed to the summary's seq.
  const [hold, setHold] = useState<{ hover: boolean; focusSeq: number | null }>(
    { hover: false, focusSeq: null },
  );
  const paused = uploadPillHeld(hold, summary?.seq ?? null);
  const closePill = useCallback(() => {
    setPill(IDLE);
    setHold({ hover: false, focusSeq: null });
  }, []);
  useAutoDismiss(
    timerMs,
    paused,
    summary ? `${summary.batchId}:${summary.seq}:${policy.kind}` : "idle",
    closePill,
  );
  const dock = useDockBottom(pill.active, dockKey);
  // No running count: a polite region re-announces on every change.
  const liveReadiness = policy.kind === "wait"
    ? "preparing previews"
    : showCta
      ? `${ctaCount} ready to analyze with AI`
      : "";
  const skipLabels = summary
    ? [
      summary.skippedReasons.empty > 0 ? `${summary.skippedReasons.empty} empty` : null,
      summary.skippedReasons["too-large"] > 0
        ? `${summary.skippedReasons["too-large"]} over 100 MiB`
        : null,
      summary.skippedReasons["batch-limit"] > 0
        ? `${summary.skippedReasons["batch-limit"]} beyond 500`
        : null,
    ].filter(Boolean).join(" · ")
    : "";
  const label = pill.stage === "done" && summary
    ? [
      `${summary.uploadedCount} uploaded`,
      failedCount > 0 ? `${failedCount} failed` : null,
      summary.skippedCount > 0 ? `${summary.skippedCount} skipped` : null,
    ].filter(Boolean).join(" · ")
    : pill.stage === "finalizing"
      ? `Finalizing ${pill.totalFiles} file${pill.totalFiles === 1 ? "" : "s"}…`
      : `Uploading ${pill.doneFiles}/${pill.totalFiles} · ${pct}%`;

  return (
    <>
      {dragging && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: Z.uploadOverlay,
            background: "rgba(5,5,5,.72)",
            border: "2px dashed var(--ac)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "14px 22px",
              background: "rgba(10,10,10,.95)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              color: "var(--ac)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
          >
            {disabled ? disabledMessage ?? "UPLOAD DISABLED" : "DROP TO PLACE ON CANVAS"}
          </div>
        </div>
      )}

      {pill.active && (
        <div
          data-upload-pill
          onPointerEnter={() => setHold((h) => ({ ...h, hover: true }))}
          onPointerLeave={() => setHold((h) => ({ ...h, hover: false }))}
          onFocus={() => {
            if (summary) setHold((h) => ({ ...h, focusSeq: summary.seq }));
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setHold((h) => ({ ...h, focusSeq: null }));
            }
          }}
          style={{
            position: "fixed",
            // Docked above the bottom chrome (useDockBottom); the fallback is
            // the old spot, safe area included.
            bottom: dock ?? "calc(18px + env(safe-area-inset-bottom, 0px))",
            // left/right + auto margins, not left:50% — a fixed box with only
            // left:50% can never be wider than half the viewport.
            left: UPLOAD_PILL_SIDE_INSET,
            right: UPLOAD_PILL_SIDE_INSET,
            marginInline: "auto",
            width: "fit-content",
            zIndex: Z.uploadPill,
            minWidth: 260,
            maxWidth: `min(${UPLOAD_PILL_MAX_WIDTH}px, calc(100vw - ${2 * UPLOAD_PILL_SIDE_INSET}px))`,
            background: "rgba(12,12,12,.97)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            padding: "10px 14px",
            backdropFilter: "blur(14px)",
          }}
        >
          <div
            role={pill.stage === "done" ? "status" : undefined}
            aria-live={pill.stage === "done" ? "polite" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <div style={{ flex: 1, fontSize: 11, color: "var(--t2)", letterSpacing: "0.04em" }}>
              {label}
              {/* The readiness lines below sit outside this live region, so
                  their change (wait → the CTA appearing) is announced here. */}
              {liveReadiness && <span style={SR_ONLY}>{` · ${liveReadiness}`}</span>}
            </div>
            {pill.stage === "done" && (
              <button
                type="button"
                onClick={closePill}
                aria-label="Dismiss upload summary"
                style={{ display: "flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", border: 0, borderRadius: 2, background: "var(--bg-el)", color: "var(--t2b)", cursor: "pointer" }}
              >
                <CloseIcon width={11} height={11} />
              </button>
            )}
          </div>
          {policy.kind === "wait" && (
            <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 6, lineHeight: 1.4 }}>
              Preparing previews · {status.pending} left
            </div>
          )}
          {showCta && (
            <button
              type="button"
              // Product copy and a count only (ADR 0050).
              data-ph-unmask=""
              onClick={() => {
                if (onAnalyzeUploaded?.(status.analyzable)) closePill();
              }}
              // No aria-label: the visible "Analyze N with AI" is the name, so
              // a speech-input user can say what they see (WCAG 2.5.3); the
              // title adds the context as the description.
              title={`Analyze the ${ctaCount} uploaded ${ctaCount === 1 ? "photo" : "photos"} — opens the AI panel, see the cost before anything runs`}
              style={{
                marginTop: 9,
                height: 28,
                padding: "0 10px",
                display: "flex",
                gap: 5,
                alignItems: "center",
                border: 0,
                borderRadius: 2,
                background: "var(--ai)",
                color: "#050505",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: ".04em",
                cursor: "pointer",
              }}
            >
              <SparkleIcon width={12} height={12} strokeWidth={2} />
              Analyze {ctaCount} with AI
            </button>
          )}
          {summary && pill.stage === "done" && (failedCount > 0 || summary.skippedCount > 0) && (
            <div style={{ fontSize: 9.5, color: "var(--tm)", marginTop: 5, letterSpacing: ".04em" }}>
              Batch {summary.batchId.slice(0, 8)}
            </div>
          )}
          {pill.stage !== "done" && (
            <div style={{ height: 3, background: "var(--bg-el)", borderRadius: 999, marginTop: 8 }}>
              <div style={{ height: 3, width: `${pct}%`, background: "var(--ac)", borderRadius: 999, transition: "width .15s linear" }} />
            </div>
          )}
          {summary && summary.skippedCount > 0 && pill.stage === "done" && (
            <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 6, lineHeight: 1.4 }}>
              Skipped: {skipLabels}.
            </div>
          )}
          {summary && summary.retryLinks.length > 0 && pill.stage === "done" && (
            <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 6, lineHeight: 1.4 }}>
              {summary.retryLinks.length} uploaded file{summary.retryLinks.length === 1 ? " was" : "s were"} not added to this project.
            </div>
          )}
          {pill.errors.map((err) => (
            <div key={err} style={{ fontSize: 10.5, color: "var(--red)", marginTop: 6, lineHeight: 1.4 }}>
              {err}
            </div>
          ))}
          {pill.hiddenErrorCount > 0 && (
            <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 6 }}>
              + {pill.hiddenErrorCount} more error{pill.hiddenErrorCount === 1 ? "" : "s"}
            </div>
          )}
          {pill.stage === "done" && failedCount > 0 && (
            <button
              type="button"
              onClick={() => void retryFailed()}
              style={{ marginTop: 9, padding: "6px 10px", border: "1px solid var(--bd)", borderRadius: 2, background: "var(--bg-el)", color: "var(--t1)", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}
            >
              Retry failed ({failedCount})
            </button>
          )}
        </div>
      )}
    </>
  );
}
