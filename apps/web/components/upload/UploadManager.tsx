"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SINGLE_PUT_MAX_BYTES,
  presignUploadResponseSchema,
  completeUploadResponseSchema,
} from "@archivemind/shared";

/** Window-level drag-and-drop upload (journey step 1: direct local upload).
 *  Self-contained on purpose — no changes inside the canvas tree: listens on
 *  window, shows its own overlay + progress pill, talks to
 *  /api/uploads/presign + /complete, then enqueued ingest takes over (#8).
 *  Per-file progress needs XHR (fetch has no upload progress events). */

const PARALLEL_UPLOADS = 3;

interface UploadState {
  active: boolean;
  totalFiles: number;
  doneFiles: number;
  /** 0..1 aggregate byte progress */
  progress: number;
  errors: string[];
  queuedNote: string | null;
}

const IDLE: UploadState = {
  active: false,
  totalFiles: 0,
  doneFiles: 0,
  progress: 0,
  errors: [],
  queuedNote: null,
};

function putWithProgress(url: string, file: File, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Content-Type is part of the presigned signature — must match exactly.
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`R2 PUT failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("R2 PUT network error"));
    xhr.send(file);
  });
}

export default function UploadManager() {
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<UploadState>(IDLE);
  const dragDepth = useRef(0);
  const busy = useRef(false);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (busy.current || files.length === 0) return;
    busy.current = true;

    const accepted = files.filter((f) => f.size > 0 && f.size <= SINGLE_PUT_MAX_BYTES);
    const rejected = files.length - accepted.length;
    const errors: string[] =
      rejected > 0 ? [`${rejected} file(s) skipped — over 100 MiB (multipart lands later) or empty`] : [];
    if (accepted.length === 0) {
      setState({ ...IDLE, errors, queuedNote: null, active: errors.length > 0 });
      busy.current = false;
      if (errors.length > 0) setTimeout(() => setState(IDLE), 5000);
      return;
    }

    const totalBytes = accepted.reduce((s, f) => s + f.size, 0);
    const sentPerFile = new Array<number>(accepted.length).fill(0);
    let done = 0;
    setState({ active: true, totalFiles: accepted.length, doneFiles: 0, progress: 0, errors, queuedNote: null });

    const completed: { r2Key: string; filename: string; mime: string; size: number }[] = [];

    const uploadOne = async (file: File, i: number) => {
      const presignResp = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
      if (!presignResp.ok) throw new Error(`${file.name}: presign failed (${presignResp.status})`);
      const { uploadUrl, r2Key } = presignUploadResponseSchema.parse(await presignResp.json());
      await putWithProgress(uploadUrl, file, (sent) => {
        sentPerFile[i] = sent;
        const sentTotal = sentPerFile.reduce((s, n) => s + n, 0);
        setState((prev) => ({ ...prev, progress: Math.min(1, sentTotal / totalBytes) }));
      });
      sentPerFile[i] = file.size;
      completed.push({
        r2Key,
        filename: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      });
      done += 1;
      setState((prev) => ({ ...prev, doneFiles: done }));
    };

    // Simple pool: PARALLEL_UPLOADS at a time.
    const queue = accepted.map((file, i) => ({ file, i }));
    const runners = Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          await uploadOne(next.file, next.i);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
          setState((prev) => ({ ...prev, errors: [...errors] }));
        }
      }
    });
    await Promise.all(runners);

    let queuedNote: string | null = null;
    if (completed.length > 0) {
      const completeResp = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploads: completed }),
      });
      if (completeResp.ok) {
        const { assetIds } = completeUploadResponseSchema.parse(await completeResp.json());
        queuedNote = `${assetIds.length} file(s) uploaded — queued for processing`;
      } else {
        errors.push(`complete failed (${completeResp.status})`);
      }
    }

    setState({
      active: true,
      totalFiles: accepted.length,
      doneFiles: done,
      progress: 1,
      errors: [...errors],
      queuedNote,
    });
    busy.current = false;
    setTimeout(() => setState(IDLE), errors.length > 0 ? 8000 : 4000);
  }, []);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      void uploadFiles(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [uploadFiles]);

  const pct = Math.round(state.progress * 100);

  return (
    <>
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
            DROP FILES TO UPLOAD
          </div>
        </div>
      )}

      {state.active && (
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
          <div style={{ fontSize: 11, color: "var(--t2)", letterSpacing: "0.04em" }}>
            {state.queuedNote ??
              `Uploading ${state.doneFiles}/${state.totalFiles} · ${pct}%`}
          </div>
          {!state.queuedNote && (
            <div style={{ height: 3, background: "var(--bg-el)", borderRadius: 999, marginTop: 8 }}>
              <div
                style={{
                  height: 3,
                  width: `${pct}%`,
                  background: "var(--ac)",
                  borderRadius: 999,
                  transition: "width .2s",
                }}
              />
            </div>
          )}
          {state.errors.map((err) => (
            <div key={err} style={{ fontSize: 10.5, color: "var(--red)", marginTop: 6, lineHeight: 1.4 }}>
              {err}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
