"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSmoothProgress } from "@/hooks/useSmoothProgress";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";
import {
  createUploadBatchId,
  runUpload,
  uploadCandidates,
  type UploadProgress,
} from "@/lib/upload-client";
import type { UploadBatchResult, UploadBatchStart, UploadResult } from "@/types";

/** Import modal (issue #17): opens on a fresh project (or via the toolbar
 *  "Add"). Left = source picker (Local active; Drive/Dropbox land in Phase 6);
 *  right = drop-or-browse zone that uploads and links the new assets into the
 *  current project via the shared lib/upload-client. Files then appear on the
 *  canvas. Drops on the modal are handled here (stopPropagation), so the global
 *  UploadManager never double-handles them. */

type Source = "local" | "gdrive" | "dropbox";
type Phase = "idle" | "uploading" | "done";

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
  const [result, setResult] = useState<{ added: number; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const smooth = useSmoothProgress(prog.progress, phase === "uploading");
  const pct = Math.round(smooth * 100);

  // Esc closes like every other modal — owned here (not the global handler in
  // useWorkspace) because closing must be blocked while an upload is in flight,
  // and only this component knows the phase.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "uploading") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, phase, onClose]);

  if (!open) return null;

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
        projectId,
        onProgress: (p) => setProg(p),
      });
    } catch (error) {
      uploadResult = {
        assetIds: [],
        uploaded: [],
        failedIndexes: candidates.map((item) => item.inputIndex),
        skippedIndexes: [],
        jobId: null,
        projectLink: "not-requested",
        errors: [error instanceof Error ? error.message : "Upload failed"],
        skipped: 0,
      };
    } finally {
      busyRef.current = false;
    }
    if (candidates.length > 0) onBatchSettled?.({ batchId: id, ...uploadResult });
    const errs = [...uploadResult.errors];
    if (uploadResult.skipped > 0) errs.push(`${uploadResult.skipped} file(s) skipped — empty, over 100 MiB, or beyond the 500-file batch limit`);
    if (uploadResult.assetIds.length > 0) router.refresh();
    setResult({ added: uploadResult.assetIds.length, errors: errs });
    setPhase("done");
  }

  const isProject = projectId !== "all";

  return (
    <div
      onClick={phase === "uploading" ? undefined : onClose}
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
          <SourceItem label="Google Drive" soon active={source === "gdrive"} onClick={() => setSource("gdrive")} icon={<CloudIcon />} />
          <SourceItem label="Dropbox" soon active={source === "dropbox"} onClick={() => setSource("dropbox")} icon={<CloudIcon />} />
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
              onClick={phase === "uploading" ? undefined : onClose}
              disabled={phase === "uploading"}
              aria-label="Close"
              style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", border: 0, background: "var(--bg-el)", color: "var(--t2b)", cursor: phase === "uploading" ? "default" : "pointer", opacity: phase === "uploading" ? 0.45 : 1, borderRadius: 2 }}
            >
              <CloseIcon />
            </button>
          </div>

          {source !== "local" ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--tm)", textAlign: "center", padding: 20 }}>
              <CloudIcon large />
              <div style={{ fontSize: 13, color: "var(--t2)" }}>{source === "gdrive" ? "Google Drive" : "Dropbox"} import — coming soon</div>
              <div style={{ fontSize: 11.5 }}>Pick files from the cloud without leaving ArchiveMind. Lands in a later phase.</div>
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
                      {result.added} file{result.added === 1 ? "" : "s"} added
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>Processing previews — they’ll appear on the canvas shortly.</div>
                    {result.errors.map((err) => (
                      <div key={err} style={{ fontSize: 10.5, color: "var(--red)" }}>{err}</div>
                    ))}
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPhase("idle"); setResult(null); }}
                        style={{ padding: "7px 12px", background: "var(--bg-el)", color: "var(--t2)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        Add more
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
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
