"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGdriveConnection } from "@/hooks/useGdriveConnection";
import { useSmoothProgress } from "@/hooks/useSmoothProgress";
import { driveErrorMessage } from "@/lib/drive-errors";
import { runCloudImport, type DriveImportResult } from "@/lib/drive-import";
import { DropboxUiError, openDropboxChooser } from "@/lib/dropbox-chooser";
import { DriveAuthError, openDrivePicker, requestPickerToken } from "@/lib/google-identity";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";
import {
  createUploadBatchId,
  retryProjectLinks,
  runUpload,
  uploadCandidates,
  type UploadProgress,
} from "@/lib/upload-client";
import type {
  IndexedUploadFile,
  UploadedFileResult,
  UploadBatchResult,
  UploadBatchStart,
  UploadResult,
  UploadSkipReason,
} from "@/types";

/** Import modal (issue #17): opens on a fresh project (or via the toolbar
 *  "Add"). Left = source picker (Local active; Drive/Dropbox land in Phase 6);
 *  right = drop-or-browse zone that uploads and links the new assets into the
 *  current project via the shared lib/upload-client. Files then appear on the
 *  canvas. Drops on the modal are handled here (stopPropagation), so the global
 *  UploadManager never double-handles them. */

type Source = "local" | "gdrive" | "dropbox";
type Phase = "idle" | "uploading" | "done";
type DrivePhase = "idle" | "picking" | "importing" | "done";

interface LinkRetry {
  file: IndexedUploadFile;
  uploaded: UploadedFileResult;
}

interface LocalUploadResult {
  batchId: string;
  projectId: string;
  uploadedCount: number;
  skippedCount: number;
  skippedReasons: Record<UploadSkipReason, number>;
  retryFiles: IndexedUploadFile[];
  retryLinks: LinkRetry[];
  errors: string[];
  hiddenErrorCount: number;
}

const MAX_VISIBLE_UPLOAD_ERRORS = 3;
const EMPTY_SKIP_COUNTS: Record<UploadSkipReason, number> = {
  empty: 0,
  "too-large": 0,
  "batch-limit": 0,
};

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

function boundedErrors(errors: readonly string[]) {
  const unique = Array.from(new Set(errors));
  return {
    errors: unique.slice(0, MAX_VISIBLE_UPLOAD_ERRORS),
    hiddenErrorCount: Math.max(0, unique.length - MAX_VISIBLE_UPLOAD_ERRORS),
  };
}

function mergeSkipCounts(
  previous: Record<UploadSkipReason, number>,
  uploadResult: UploadResult,
): Record<UploadSkipReason, number> {
  const next = { ...previous };
  for (const skipped of uploadResult.skippedFiles) next[skipped.reason] += 1;
  return next;
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

export default function ImportModal({
  open,
  onClose,
  projectId,
  projectName,
  onBatchStart,
  onBatchSettled,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onBatchStart?: (batch: UploadBatchStart) => void;
  onBatchSettled?: (result: UploadBatchResult) => void;
}) {
  const router = useRouter();
  const [source, setSource] = useState<Source>("local");
  const [phase, setPhase] = useState<Phase>("idle");
  const [prog, setProg] = useState<UploadProgress>({ totalFiles: 0, doneFiles: 0, progress: 0, stage: "uploading" });
  const [result, setResult] = useState<LocalUploadResult | null>(null);
  const [syncedOpen, setSyncedOpen] = useState(open);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const smooth = useSmoothProgress(prog.progress, phase === "uploading");
  const pct = Math.round(smooth * 100);

  // ── Google Drive pane state (ADR 0025) ─────────────────────────────────
  const [driveMsg, setDriveMsg] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const notifyDrive = (text: string, kind: "ok" | "error" = "error") => setDriveMsg({ text, kind });
  const [drivePhase, setDrivePhase] = useState<DrivePhase>("idle");
  const [driveProg, setDriveProg] = useState<{ submitted: number; total: number }>({ submitted: 0, total: 0 });
  const [driveResult, setDriveResult] = useState<DriveImportResult | null>(null);
  const { gdrive, refresh: refreshGdrive, connect: connectGdrive } = useGdriveConnection(notifyDrive);

  const busyDrive = drivePhase === "picking" || drivePhase === "importing";
  const [dbxMsg, setDbxMsg] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const [dbxPhase, setDbxPhase] = useState<DrivePhase>("idle");
  const [dbxProg, setDbxProg] = useState<{ submitted: number; total: number }>({ submitted: 0, total: 0 });
  const [dbxResult, setDbxResult] = useState<DriveImportResult | null>(null);
  const dbxBusy = dbxPhase === "picking" || dbxPhase === "importing";
  const blocked = phase === "uploading" || busyDrive || dbxBusy;

  // The modal stays mounted while hidden. Reset its local File references on
  // an owner-driven close; the guarded render adjustment avoids an extra
  // effect/render cycle and mirrors the prop-sync pattern used by useWorkspace.
  if (syncedOpen !== open) {
    setSyncedOpen(open);
    if (!open) {
      setPhase("idle");
      setResult(null);
    }
  }

  useEffect(() => {
    if (open && source === "gdrive" && !gdrive.loaded) void refreshGdrive();
  }, [open, source, gdrive.loaded, refreshGdrive]);

  // Esc closes like every other modal — owned here (not the global handler in
  // useWorkspace) because closing must be blocked while an upload/import is in
  // flight, and only this component knows the phase.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !blocked) {
        setPhase("idle");
        setResult(null);
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, blocked, onClose]);

  if (!open) return null;

  async function pickFromDrive() {
    if (busyDrive || !gdrive.connectionId) return;
    setDriveMsg(null);
    setDrivePhase("picking");
    try {
      const token = await requestPickerToken(gdrive.email ?? undefined);
      const picked = await openDrivePicker(token);
      if (picked.length === 0) {
        setDrivePhase("idle"); // user cancelled the picker
        return;
      }
      setDriveProg({ submitted: 0, total: picked.length });
      setDrivePhase("importing");
      const res = await runCloudImport({
        provider: "gdrive",
        items: picked.map((p) => ({
          fileId: p.fileId,
          name: p.name,
          mimeType: p.mimeType,
          sizeBytes: p.sizeBytes,
        })),
        connectionId: gdrive.connectionId,
        projectId: isProject ? projectId : undefined,
        onProgress: (submitted, total) => setDriveProg({ submitted, total }),
      });
      setDriveResult(res);
      if (res.failedChunks.length > 0) notifyDrive(driveErrorMessage(res.failedChunks[0]));
      if (res.assetIds.length > 0 || res.linkedExisting > 0) router.refresh();
      setDrivePhase("done");
    } catch (err) {
      notifyDrive(driveErrorMessage(err instanceof DriveAuthError ? err.code : undefined));
      setDrivePhase("idle");
    }
  }

  async function pickFromDropbox() {
    if (dbxBusy) return;
    setDbxMsg(null);
    setDbxPhase("picking");
    try {
      const picked = await openDropboxChooser();
      if (picked.length === 0) {
        setDbxPhase("idle"); // user cancelled the chooser
        return;
      }
      setDbxProg({ submitted: 0, total: picked.length });
      setDbxPhase("importing");
      const res = await runCloudImport({
        provider: "dropbox",
        items: picked,
        projectId: isProject ? projectId : undefined,
        onProgress: (submitted, total) => setDbxProg({ submitted, total }),
      });
      setDbxResult(res);
      if (res.failedChunks.length > 0) setDbxMsg({ text: driveErrorMessage(res.failedChunks[0]), kind: "error" });
      if (res.assetIds.length > 0 || res.linkedExisting > 0) router.refresh();
      setDbxPhase("done");
    } catch (err) {
      setDbxMsg({ text: driveErrorMessage(err instanceof DropboxUiError ? err.code : undefined), kind: "error" });
      setDbxPhase("idle");
    }
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0 || busyRef.current) return;
    busyRef.current = true;
    const id = createUploadBatchId();
    const candidates = uploadCandidates(files);
    if (candidates.length > 0) {
      onBatchStart?.({ batchId: id, origin: "import-modal", clientPoint: null, files: candidates });
    }
    setPhase("uploading");
    setResult(null);
    let uploadResult: UploadResult;
    try {
      uploadResult = await runUpload(files, {
        batchId: id,
        projectId,
        onProgress: (p) => setProg(p),
      });
    } catch (error) {
      uploadResult = failedUploadResult(
        candidates.map((item) => item.inputIndex),
        error instanceof Error ? error.message : "Upload failed",
      );
    } finally {
      busyRef.current = false;
    }
    if (candidates.length > 0) onBatchSettled?.({ batchId: id, ...uploadResult });
    if (uploadResult.assetIds.length > 0) router.refresh();
    setResult({
      batchId: id,
      projectId,
      uploadedCount: uploadResult.uploaded.length,
      skippedCount: uploadResult.skipped,
      skippedReasons: mergeSkipCounts(EMPTY_SKIP_COUNTS, uploadResult),
      retryFiles: retryFilesFor(candidates, uploadResult),
      retryLinks: linkRetriesFor(candidates, uploadResult),
      ...boundedErrors(uploadResult.errors),
    });
    setPhase("done");
  }

  async function retryFailed() {
    if (!result || busyRef.current) return;
    const retryInputs = [
      ...result.retryFiles,
      ...result.retryLinks.map((item) => item.file),
    ];
    if (retryInputs.length === 0) return;

    busyRef.current = true;
    onBatchStart?.({
      batchId: result.batchId,
      origin: "import-modal",
      clientPoint: null,
      files: retryInputs,
    });
    setProg({
      totalFiles: retryInputs.length,
      doneFiles: 0,
      progress: result.retryFiles.length > 0 ? 0 : 0.96,
      stage: result.retryFiles.length > 0 ? "uploading" : "finalizing",
    });
    setPhase("uploading");

    const uploadPromise = result.retryFiles.length > 0
      ? runUpload(result.retryFiles, {
        batchId: result.batchId,
        projectId: result.projectId,
        onProgress: (progress) => setProg({
          ...progress,
          // Link-only failures already own real assets and retry alongside the
          // byte failures; do not announce completion until both legs settle.
          stage: progress.stage === "done" && result.retryLinks.length > 0
            ? "finalizing"
            : progress.stage,
        }),
      }).catch((error) => failedUploadResult(
        result.retryFiles.map((item) => item.inputIndex),
        error instanceof Error ? error.message : "Upload failed",
      ))
      : Promise.resolve(emptyUploadResult());
    const linkPromise = result.retryLinks.length > 0
      ? retryProjectLinks(
        result.retryLinks.map((item) => item.uploaded),
        { projectId: result.projectId, batchId: result.batchId },
      ).catch((error) => ({
        failedIndexes: result.retryLinks.map((item) => item.file.inputIndex),
        errors: [error instanceof Error ? error.message : "add to project failed"],
      }))
      : Promise.resolve({ failedIndexes: [] as number[], errors: [] as string[] });

    const [uploadResult, linkResult] = await Promise.all([uploadPromise, linkPromise]);
    busyRef.current = false;
    const previousLinksByIndex = new Map(
      result.retryLinks.map((item) => [item.file.inputIndex, item]),
    );
    const remainingPreviousLinks = linkResult.failedIndexes.flatMap((inputIndex): LinkRetry[] => {
      const retry = previousLinksByIndex.get(inputIndex);
      return retry ? [retry] : [];
    });
    const newLinkRetries = linkRetriesFor(result.retryFiles, uploadResult);
    const retriedLinkUploads = result.retryLinks.map((item) => item.uploaded);
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
      projectLink: result.projectId === "all"
        ? "not-requested"
        : linkFailedIndexes.length > 0 ? "failed" : "linked",
      projectLinkFailedIndexes: linkFailedIndexes,
      errors: [...uploadResult.errors, ...linkResult.errors],
    };
    onBatchSettled?.({ batchId: result.batchId, ...combinedResult });
    if (combinedResult.assetIds.length > 0) router.refresh();
    setResult({
      ...result,
      uploadedCount: result.uploadedCount + uploadResult.uploaded.length,
      skippedCount: result.skippedCount + uploadResult.skipped,
      skippedReasons: mergeSkipCounts(result.skippedReasons, uploadResult),
      retryFiles: retryFilesFor(result.retryFiles, uploadResult),
      retryLinks: [...remainingPreviousLinks, ...newLinkRetries],
      ...boundedErrors(combinedResult.errors),
    });
    setPhase("done");
  }

  function dismissLocalSummary() {
    setPhase("idle");
    setResult(null);
  }

  function closeModal() {
    dismissLocalSummary();
    onClose();
  }

  const isProject = projectId !== "all";

  return (
    <div
      onClick={blocked ? undefined : closeModal}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.modal,
        background: MODAL_BACKDROP,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: MODAL_BLUR,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 660,
          maxWidth: "92vw",
          height: 420,
          maxHeight: "86vh",
          display: "flex",
          background: "var(--bg-s)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          overflow: "hidden",
          boxShadow: "0 30px 90px rgba(0,0,0,.6)",
        }}
      >
        {/* ── left: sources ─────────────────────────────────────────── */}
        <div style={{ width: 186, flex: "0 0 auto", background: "var(--bg)", borderRight: "1px solid var(--bd)", padding: 14, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)", padding: "2px 6px 14px" }}>Add files</div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)", padding: "0 6px 8px" }}>
            Source
          </div>
          <SourceItem label="Local files" active={source === "local"} onClick={() => setSource("local")} icon={<UploadIcon />} />
          <SourceItem label="Google Drive" active={source === "gdrive"} onClick={() => setSource("gdrive")} icon={<CloudIcon />} />
          <SourceItem label="Dropbox" active={source === "dropbox"} onClick={() => setSource("dropbox")} icon={<CloudIcon />} />
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10.5, color: "var(--tm)", padding: "0 6px", lineHeight: 1.5 }}>
            {isProject ? `Files are added to “${projectName}”.` : "Files are added to your archive."}
          </div>
        </div>

        {/* ── right: upload area ────────────────────────────────────── */}
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: "var(--t2)" }}>
              {source === "local" ? "Local files" : source === "gdrive" ? "Google Drive" : "Dropbox"}
            </span>
            <button
              onClick={blocked ? undefined : closeModal}
              disabled={blocked}
              aria-label="Close"
              style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", border: 0, background: "var(--bg-el)", color: "var(--t2b)", cursor: blocked ? "default" : "pointer", opacity: blocked ? 0.45 : 1, borderRadius: 2 }}
            >
              <CloseIcon />
            </button>
          </div>

          {source === "dropbox" ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--tm)", textAlign: "center", padding: 20, border: "2px dashed var(--bdh)", borderRadius: 3, background: "var(--bg)" }}>
              <CloudIcon large />
              {dbxPhase === "importing" ? (
                <>
                  <div style={{ fontSize: 13, color: "var(--t1)" }}>
                    Submitting {dbxProg.submitted}/{dbxProg.total}…
                  </div>
                  <div style={{ width: 220, height: 3, background: "var(--bg-el)", borderRadius: 999 }}>
                    <div style={{ height: 3, width: `${dbxProg.total ? Math.round((dbxProg.submitted / dbxProg.total) * 100) : 0}%`, background: "var(--ac)", borderRadius: 999, transition: "width .15s linear" }} />
                  </div>
                </>
              ) : dbxPhase === "done" && dbxResult ? (
                <>
                  <div style={{ fontSize: 13, color: "var(--ac)", fontWeight: 700 }}>
                    {dbxResult.assetIds.length} file{dbxResult.assetIds.length === 1 ? "" : "s"} imported
                  </div>
                  {dbxResult.linkedExisting > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>
                      {dbxResult.linkedExisting} already imported — added to this project
                    </div>
                  )}
                  {dbxResult.skippedDuplicates - dbxResult.linkedExisting > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>
                      {dbxResult.skippedDuplicates - dbxResult.linkedExisting} duplicate{dbxResult.skippedDuplicates - dbxResult.linkedExisting === 1 ? "" : "s"} skipped
                    </div>
                  )}
                  {dbxResult.assetIds.length > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>Fetching originals from Dropbox — they’ll appear on the canvas shortly.</div>
                  )}
                  {dbxMsg && <div style={{ fontSize: 10.5, color: dbxMsg.kind === "ok" ? "var(--ac)" : "var(--red)" }}>{dbxMsg.text}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      onClick={() => { setDbxPhase("idle"); setDbxResult(null); setDbxMsg(null); }}
                      style={{ padding: "7px 12px", background: "var(--bg-el)", color: "var(--t2)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Pick more
                    </button>
                    <button
                      onClick={closeModal}
                      style={{ padding: "7px 14px", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "var(--t1)" }}>Pick files straight from Dropbox</div>
                  <div style={{ fontSize: 11.5 }}>
                    No account link needed — Dropbox opens its own picker and shares only the files you choose. Links are fetched right away.
                  </div>
                  {dbxMsg && <div style={{ fontSize: 10.5, color: dbxMsg.kind === "ok" ? "var(--ac)" : "var(--red)" }}>{dbxMsg.text}</div>}
                  <button
                    onClick={() => void pickFromDropbox()}
                    disabled={dbxBusy}
                    style={{ marginTop: 4, padding: "8px 16px", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: dbxBusy ? "default" : "pointer", opacity: dbxBusy ? 0.6 : 1, fontFamily: "inherit" }}
                  >
                    {dbxPhase === "picking" ? "Opening Dropbox…" : "Pick files from Dropbox"}
                  </button>
                </>
              )}
            </div>
          ) : source === "gdrive" ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--tm)", textAlign: "center", padding: 20, border: "2px dashed var(--bdh)", borderRadius: 3, background: "var(--bg)" }}>
              <CloudIcon large />
              {!gdrive.loaded ? (
                <div style={{ fontSize: 12.5, color: "var(--t3)" }}>Checking connection…</div>
              ) : drivePhase === "importing" ? (
                <>
                  <div style={{ fontSize: 13, color: "var(--t1)" }}>
                    Submitting {driveProg.submitted}/{driveProg.total}…
                  </div>
                  <div style={{ width: 220, height: 3, background: "var(--bg-el)", borderRadius: 999 }}>
                    <div style={{ height: 3, width: `${driveProg.total ? Math.round((driveProg.submitted / driveProg.total) * 100) : 0}%`, background: "var(--ac)", borderRadius: 999, transition: "width .15s linear" }} />
                  </div>
                </>
              ) : drivePhase === "done" && driveResult ? (
                <>
                  <div style={{ fontSize: 13, color: "var(--ac)", fontWeight: 700 }}>
                    {driveResult.assetIds.length} file{driveResult.assetIds.length === 1 ? "" : "s"} imported
                  </div>
                  {driveResult.linkedExisting > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>
                      {driveResult.linkedExisting} already imported — added to this project
                    </div>
                  )}
                  {driveResult.skippedDuplicates - driveResult.linkedExisting > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>
                      {driveResult.skippedDuplicates - driveResult.linkedExisting} duplicate{driveResult.skippedDuplicates - driveResult.linkedExisting === 1 ? "" : "s"} skipped
                    </div>
                  )}
                  {driveResult.assetIds.length > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>Streaming previews from Drive — they’ll appear on the canvas shortly.</div>
                  )}
                  {driveMsg && <div style={{ fontSize: 10.5, color: driveMsg.kind === "ok" ? "var(--ac)" : "var(--red)" }}>{driveMsg.text}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      onClick={() => { setDrivePhase("idle"); setDriveResult(null); setDriveMsg(null); }}
                      style={{ padding: "7px 12px", background: "var(--bg-el)", color: "var(--t2)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Pick more
                    </button>
                    <button
                      onClick={closeModal}
                      style={{ padding: "7px 14px", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : !gdrive.connected ? (
                <>
                  <div style={{ fontSize: 13, color: "var(--t2)" }}>Connect your Google Drive to pick files</div>
                  <div style={{ fontSize: 11.5 }}>One-time approval in a Google popup; you stay in control of exactly which files ArchiveMind can see.</div>
                  {driveMsg && <div style={{ fontSize: 10.5, color: driveMsg.kind === "ok" ? "var(--ac)" : "var(--red)" }}>{driveMsg.text}</div>}
                  <button
                    onClick={() => void connectGdrive()}
                    disabled={gdrive.busy}
                    style={{ marginTop: 4, padding: "8px 16px", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: gdrive.busy ? "default" : "pointer", opacity: gdrive.busy ? 0.6 : 1, fontFamily: "inherit" }}
                  >
                    {gdrive.busy ? "…" : "Connect Google Drive"}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "var(--t1)" }}>
                    Connected{gdrive.email ? ` as ${gdrive.email}` : ""}
                  </div>
                  <div style={{ fontSize: 11.5 }}>
                    Google grants access only to files you explicitly pick — open a folder and shift-select.
                  </div>
                  {driveMsg && <div style={{ fontSize: 10.5, color: driveMsg.kind === "ok" ? "var(--ac)" : "var(--red)" }}>{driveMsg.text}</div>}
                  <button
                    onClick={() => void pickFromDrive()}
                    disabled={busyDrive}
                    style={{ marginTop: 4, padding: "8px 16px", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: busyDrive ? "default" : "pointer", opacity: busyDrive ? 0.6 : 1, fontFamily: "inherit" }}
                  >
                    {drivePhase === "picking" ? "Opening picker…" : "Pick files from Drive"}
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div
                onClick={() => phase !== "uploading" && inputRef.current?.click()}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation(); // keep the global UploadManager from double-handling
                  setDragOver(false);
                  void handleFiles(Array.from(e.dataTransfer.files));
                }}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  border: `2px dashed ${dragOver ? "var(--ac)" : "var(--bdh)"}`,
                  borderRadius: 3,
                  background: dragOver ? "color-mix(in srgb,var(--ac) 6%,transparent)" : "var(--bg)",
                  cursor: phase === "uploading" ? "default" : "pointer",
                  textAlign: "center",
                  padding: 20,
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    void handleFiles(files);
                  }}
                />
                {phase === "uploading" ? (
                  <>
                    <div style={{ fontSize: 13, color: "var(--t1)" }}>
                      {prog.stage === "finalizing"
                        ? `Finalizing ${prog.totalFiles} file${prog.totalFiles === 1 ? "" : "s"}…`
                        : `Uploading ${prog.doneFiles}/${prog.totalFiles} · ${pct}%`}
                    </div>
                    <div style={{ width: 220, height: 3, background: "var(--bg-el)", borderRadius: 999 }}>
                      <div style={{ height: 3, width: `${pct}%`, background: "var(--ac)", borderRadius: 999, transition: "width .15s linear" }} />
                    </div>
                  </>
                ) : phase === "done" && result ? (
                  <>
                    <div style={{ fontSize: 13, color: "var(--ac)", fontWeight: 700 }}>
                      {result.uploadedCount} file{result.uploadedCount === 1 ? "" : "s"} uploaded
                    </div>
                    {result.uploadedCount > 0 && (
                      <div style={{ fontSize: 11.5, color: "var(--t3)" }}>Processing previews — they’ll appear on the canvas shortly.</div>
                    )}
                    {(result.retryFiles.length > 0 || result.retryLinks.length > 0 || result.skippedCount > 0) && (
                      <div style={{ fontSize: 10, color: "var(--tm)", letterSpacing: ".04em" }}>
                        Batch {result.batchId.slice(0, 8)}
                      </div>
                    )}
                    {result.retryFiles.length > 0 && (
                      <div style={{ fontSize: 10.5, color: "var(--red)" }}>
                        {result.retryFiles.length} file{result.retryFiles.length === 1 ? "" : "s"} failed to upload.
                      </div>
                    )}
                    {result.retryLinks.length > 0 && (
                      <div style={{ fontSize: 10.5, color: "var(--red)" }}>
                        {result.retryLinks.length} uploaded file{result.retryLinks.length === 1 ? " was" : "s were"} not added to this project.
                      </div>
                    )}
                    {result.skippedCount > 0 && (
                      <div style={{ fontSize: 10.5, color: "var(--t3)" }}>
                        Skipped: {[
                          result.skippedReasons.empty > 0 ? `${result.skippedReasons.empty} empty` : null,
                          result.skippedReasons["too-large"] > 0
                            ? `${result.skippedReasons["too-large"]} over 100 MiB`
                            : null,
                          result.skippedReasons["batch-limit"] > 0
                            ? `${result.skippedReasons["batch-limit"]} beyond 500`
                            : null,
                        ].filter(Boolean).join(" · ")}.
                      </div>
                    )}
                    {result.errors.map((err) => (
                      <div key={err} style={{ fontSize: 10.5, color: "var(--red)" }}>{err}</div>
                    ))}
                    {result.hiddenErrorCount > 0 && (
                      <div style={{ fontSize: 10.5, color: "var(--t3)" }}>
                        + {result.hiddenErrorCount} more error{result.hiddenErrorCount === 1 ? "" : "s"}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      {(result.retryFiles.length > 0 || result.retryLinks.length > 0) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void retryFailed(); }}
                          style={{ padding: "7px 12px", background: "var(--bg-el)", color: "var(--t1)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Retry failed ({result.retryFiles.length + result.retryLinks.length})
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissLocalSummary(); }}
                        style={{ padding: "7px 12px", background: "var(--bg-el)", color: "var(--t2)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); closeModal(); }}
                        style={{ padding: "7px 14px", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        Done
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <UploadIcon large />
                    <div style={{ fontSize: 13.5, color: "var(--t1)" }}>Drop photos here</div>
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>or click to browse — JPG, PNG, HEIC, RAW, PDF</div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceItem({ label, icon, active, soon, onClick }: { label: string; icon: React.ReactNode; active?: boolean; soon?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "8px 8px",
        background: active ? "var(--bg-el)" : "transparent",
        border: 0,
        borderRadius: 2,
        cursor: "pointer",
        color: active ? "var(--t1)" : "var(--t2)",
        fontSize: 13,
        fontFamily: "inherit",
        textAlign: "left",
      }}
    >
      <span style={{ display: "flex", flex: "0 0 auto" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {soon && <span style={{ fontSize: 9, letterSpacing: ".05em", color: "var(--tm)", border: "1px solid var(--bd)", borderRadius: 2, padding: "1px 4px" }}>SOON</span>}
    </button>
  );
}

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const UploadIcon = ({ large }: { large?: boolean }) => (
  <svg width={large ? 26 : 15} height={large ? 26 : 15} viewBox="0 0 24 24" {...line} style={{ color: large ? "var(--t3)" : "currentColor" }}>
    <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 20h16" />
  </svg>
);
const CloudIcon = ({ large }: { large?: boolean }) => (
  <svg width={large ? 30 : 15} height={large ? 30 : 15} viewBox="0 0 24 24" {...line} style={{ color: large ? "var(--t3)" : "currentColor" }}>
    <path d="M6 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4 4 0 0 1 18 18z" />
  </svg>
);
const CloseIcon = () => (<svg width={13} height={13} viewBox="0 0 24 24" {...line}><path d="M6 6l12 12M18 6 6 18" /></svg>);
