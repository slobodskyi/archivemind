"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSmoothProgress } from "@/hooks/useSmoothProgress";
import {
  createUploadBatchId,
  runUpload,
  uploadCandidates,
  type UploadProgress,
  type UploadStage,
} from "@/lib/upload-client";
import type { CanvasPoint, UploadBatchResult, UploadBatchStart, UploadOrigin, UploadResult } from "@/types";

/** Window-level drag-and-drop upload (journey step 1: direct local upload).
 *  Self-contained on purpose — listens on window, shows its own overlay +
 *  progress pill, delegates to lib/upload-client (shared with ImportModal).
 *  `projectId` links uploaded assets into the current project (#17).
 *
 *  Opens a file dialog when any button dispatches `am:open-upload` on the
 *  window (e.g. the homepage "Local upload" card) — one instance, one pill. */

/** Buttons anywhere can trigger the file dialog without prop-drilling. */
export const OPEN_UPLOAD_EVENT = "am:open-upload" as const;

interface UploadManagerProps {
  projectId?: string;
  /** The project import modal owns drag/drop while open. */
  disabled?: boolean;
  onBatchStart?: (batch: UploadBatchStart) => void;
  onBatchSettled?: (result: UploadBatchResult) => void;
}

interface PillState {
  active: boolean;
  totalFiles: number;
  doneFiles: number;
  progress: number;
  stage: UploadStage;
  note: string | null;
  errors: string[];
}

const IDLE: PillState = { active: false, totalFiles: 0, doneFiles: 0, progress: 0, stage: "uploading", note: null, errors: [] };

function failedUploadResult(indexes: number[], message: string): UploadResult {
  return {
    assetIds: [],
    uploaded: [],
    failedIndexes: indexes,
    skippedIndexes: [],
    jobId: null,
    projectLink: "not-requested",
    errors: [message],
    skipped: 0,
  };
}

export default function UploadManager({
  projectId,
  disabled = false,
  onBatchStart,
  onBatchSettled,
}: UploadManagerProps) {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [pill, setPill] = useState<PillState>(IDLE);
  const dragDepth = useRef(0);
  const busy = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const upload = useCallback(
    async (files: File[], origin: UploadOrigin, clientPoint: CanvasPoint | null) => {
      if (disabled || busy.current || files.length === 0) return;
      busy.current = true;
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setPill({ ...IDLE, active: true });
      const id = createUploadBatchId();
      const candidates = uploadCandidates(files);
      if (candidates.length > 0) {
        onBatchStart?.({ batchId: id, origin, clientPoint, files: candidates });
      }
      const onProgress = (p: UploadProgress) =>
        setPill((prev) => ({ ...prev, active: true, ...p }));
      let result: UploadResult;
      try {
        result = await runUpload(files, { projectId, onProgress });
      } catch (error) {
        result = failedUploadResult(
          candidates.map((item) => item.inputIndex),
          error instanceof Error ? error.message : "Upload failed",
        );
      } finally {
        busy.current = false;
      }

      if (candidates.length > 0) onBatchSettled?.({ batchId: id, ...result });
      const errs = [...result.errors];
      if (result.skipped > 0) errs.push(`${result.skipped} file(s) skipped — empty, over 100 MiB, or beyond the 500-file batch limit`);
      const note = result.assetIds.length > 0
        ? `${result.assetIds.length} file(s) uploaded — queued for processing`
        : null;
      if (result.assetIds.length > 0) router.refresh();
      setPill((prev) => ({ ...prev, active: true, progress: 1, stage: "done", note, errors: errs }));
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => setPill(IDLE), errs.length > 0 ? 8000 : 4000);
    },
    [disabled, onBatchSettled, onBatchStart, projectId, router],
  );

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (disabled) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (disabled) {
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
        "canvas-drop",
        { x: e.clientX, y: e.clientY },
      );
    };
    const onDragEnd = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const onOpen = () => {
      if (!disabled) fileInputRef.current?.click();
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener(OPEN_UPLOAD_EVENT, onOpen);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener(OPEN_UPLOAD_EVENT, onOpen);
    };
  }, [disabled, upload]);

  useEffect(() => {
    if (!disabled) return;
    dragDepth.current = 0;
    const frame = requestAnimationFrame(() => setDragging(false));
    return () => cancelAnimationFrame(frame);
  }, [disabled]);

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  const smooth = useSmoothProgress(pill.progress, pill.active);
  const pct = Math.round(smooth * 100);
  const label =
    pill.note ??
    (pill.stage === "finalizing"
      ? `Finalizing ${pill.totalFiles} file${pill.totalFiles === 1 ? "" : "s"}…`
      : `Uploading ${pill.doneFiles}/${pill.totalFiles} · ${pct}%`);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void upload(files, "file-picker", null);
        }}
      />
      {dragging && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
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
            {projectId && projectId !== "all" ? "DROP TO PLACE ON CANVAS" : "DROP FILES TO UPLOAD"}
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
            zIndex: 91,
            minWidth: 260,
            maxWidth: 420,
            background: "rgba(12,12,12,.97)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            padding: "10px 14px",
            backdropFilter: "blur(14px)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--t2)", letterSpacing: "0.04em" }}>{label}</div>
          {!pill.note && (
            <div style={{ height: 3, background: "var(--bg-el)", borderRadius: 999, marginTop: 8 }}>
              <div style={{ height: 3, width: `${pct}%`, background: "var(--ac)", borderRadius: 999, transition: "width .15s linear" }} />
            </div>
          )}
          {pill.errors.map((err) => (
            <div key={err} style={{ fontSize: 10.5, color: "var(--red)", marginTop: 6, lineHeight: 1.4 }}>
              {err}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
