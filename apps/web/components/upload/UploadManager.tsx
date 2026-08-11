"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons/icons";
import { useSmoothProgress } from "@/hooks/useSmoothProgress";
import {
  createUploadBatchId,
  retryProjectLinks,
  runUpload,
  uploadCandidates,
  type UploadProgress,
  type UploadStage,
} from "@/lib/upload-client";
import { Z } from "@/lib/ui";
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
  batchId: string;
  projectId: string;
  clientPoint: CanvasPoint;
  uploadedCount: number;
  skippedCount: number;
  skippedReasons: Record<UploadSkipReason, number>;
  retryFiles: IndexedUploadFile[];
  retryLinks: LinkRetry[];
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

export default function UploadManager({
  projectId,
  disabled = false,
  disabledMessage,
  onBatchStart,
  onBatchSettled,
}: UploadManagerProps) {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [pill, setPill] = useState<PillState>(IDLE);
  const dragDepth = useRef(0);
  const busy = useRef(false);

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
      setPill((prev) => ({
        ...prev,
        active: true,
        progress: 1,
        stage: "done",
        summary: {
          batchId: id,
          projectId,
          clientPoint,
          uploadedCount: result.uploaded.length,
          skippedCount: result.skipped,
          skippedReasons: mergeSkipCounts(EMPTY_SKIP_COUNTS, result),
          retryFiles: retryFilesFor(candidates, result),
          retryLinks: linkRetriesFor(candidates, result),
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
    setPill((current) => ({
      ...current,
      active: true,
      progress: 1,
      stage: "done",
      summary: {
        ...previous,
        uploadedCount: previous.uploadedCount + uploadResult.uploaded.length,
        skippedCount: previous.skippedCount + uploadResult.skipped,
        skippedReasons: mergeSkipCounts(previous.skippedReasons, uploadResult),
        retryFiles: retryFilesFor(previous.retryFiles, uploadResult),
        retryLinks: [...remainingPreviousLinks, ...newLinkRetries],
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
          style={{
            position: "fixed",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: Z.uploadPill,
            minWidth: 260,
            maxWidth: 420,
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
            <div style={{ flex: 1, fontSize: 11, color: "var(--t2)", letterSpacing: "0.04em" }}>{label}</div>
            {pill.stage === "done" && (
              <button
                type="button"
                onClick={() => setPill(IDLE)}
                aria-label="Dismiss upload summary"
                style={{ display: "flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", border: 0, borderRadius: 2, background: "var(--bg-el)", color: "var(--t2b)", cursor: "pointer" }}
              >
                <CloseIcon width={11} height={11} />
              </button>
            )}
          </div>
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
