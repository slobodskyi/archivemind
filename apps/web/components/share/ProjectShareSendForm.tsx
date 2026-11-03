"use client";

import { useId, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { SINGLE_PUT_MAX_BYTES } from "@archivemind/shared";
import { PROJECT_SHARE_SENDER_MAX } from "@/lib/project-share-uploads";
import { runShareUpload, type ShareUploadResult } from "@/lib/share-upload-client";
import { UPLOAD_SELECTION_LIMIT, selectUploadFiles } from "@/lib/upload-client";

/** The send form of a project share link with upload rights (ADR 0051 §9).
 *  It learns nothing about the project: what it shows after a send is only
 *  how many files arrived — never what they became, and never whether one
 *  matched a file the project already had. */

const MONO = "var(--font-space-mono), var(--font-mono-cy), monospace";

const button: CSSProperties = {
  minHeight: 40,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "0 14px",
  border: "1px solid var(--bdh)",
  borderRadius: 2,
  background: "rgba(8,8,8,.78)",
  color: "var(--t1)",
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
};

const primaryButton: CSSProperties = { ...button, borderColor: "var(--ac)", background: "var(--ac)", color: "#050505" };

const fieldLabel: CSSProperties = { display: "block", color: "var(--t2)", fontFamily: MONO, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase" };

type SendState =
  | { phase: "picking" }
  | { phase: "sending"; progress: number; done: number; total: number }
  | { phase: "finished"; result: ShareUploadResult };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function files(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/** What the finished send says. Exported for the static-render check. */
export function sendOutcomeCopy(result: ShareUploadResult): { headline: string; detail: string | null } {
  const missed = result.failedIndexes.length;
  const headline = result.received > 0 ? `${files(result.received)} received` : "No files were received";
  if (result.linkGone) return { headline, detail: "This link no longer accepts files. Ask the person who shared it for a new one." };
  if (result.quotaReached) {
    return { headline, detail: "This link has taken all the files it can. Ask the person who shared it for a new one." };
  }
  if (missed > 0) return { headline, detail: `${files(missed)} did not arrive. You can send ${missed === 1 ? "it" : "them"} again.` };
  return { headline, detail: null };
}

export default function ProjectShareSendForm({ token }: { token: string }) {
  const nameId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [senderName, setSenderName] = useState("");
  const [picked, setPicked] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<SendState>({ phase: "picking" });

  const selection = selectUploadFiles(picked);
  const ready = selection.candidates.map((item) => item.file);
  const tooLarge = selection.skippedFiles.filter((item) => item.reason === "too-large").length;
  const overLimit = selection.skippedFiles.filter((item) => item.reason === "batch-limit").length;
  const readyBytes = ready.reduce((sum, file) => sum + file.size, 0);
  const sending = state.phase === "sending";
  // A dead or full link takes nothing more: picking files again would only
  // meet the same answer.
  const closed = state.phase === "finished" && (state.result.linkGone || state.result.quotaReached);
  const maxFileSize = `${Math.round(SINGLE_PUT_MAX_BYTES / (1024 * 1024))} MB`;

  const addFiles = (list: FileList | null) => {
    if (!list || sending || closed) return;
    setPicked((current) => [...current, ...Array.from(list)]);
    if (state.phase === "finished") setState({ phase: "picking" });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const send = async (toSend: File[]) => {
    if (!toSend.length || sending) return;
    setState({ phase: "sending", progress: 0, done: 0, total: toSend.length });
    const result = await runShareUpload(token, toSend, {
      senderName: senderName.trim() || null,
      onProgress: (p) => setState({ phase: "sending", progress: p.progress, done: p.doneFiles, total: p.totalFiles }),
    });
    // Keep only what did not arrive, so "Send again" is one click.
    setPicked(result.failedIndexes.map((index) => toSend[index]));
    setState({ phase: "finished", result });
  };

  const outcome = state.phase === "finished" ? sendOutcomeCopy(state.result) : null;
  const retryable = state.phase === "finished" && !state.result.linkGone && !state.result.quotaReached && picked.length > 0;

  return (
    <section id="send-files" className="public-share-files" aria-labelledby="send-files-title" style={{ marginTop: 56 }}>
      <div className="public-share-files-lead">
        <div>
          <div className="public-share-kicker">Send files</div>
          <h2 id="send-files-title">Add your files</h2>
        </div>
        <p>
          Files you send go straight into this project. Each file can be up to {maxFileSize},
          and up to {UPLOAD_SELECTION_LIMIT} at a time. They arrive exactly as sent, camera details and location included.
        </p>
      </div>

      <div style={{ marginTop: 22, maxWidth: 560 }}>
        <label htmlFor={nameId} style={fieldLabel}>Your name (optional)</label>
        <input
          id={nameId}
          type="text"
          autoComplete="name"
          maxLength={PROJECT_SHARE_SENDER_MAX}
          value={senderName}
          disabled={sending || closed}
          onChange={(event) => setSenderName(event.target.value)}
          placeholder="So they know who sent these"
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            minHeight: 40,
            marginTop: 6,
            padding: "0 12px",
            border: "1px solid var(--bdh)",
            borderRadius: 2,
            background: "rgba(8,8,8,.78)",
            color: "var(--t1)",
            fontSize: 14,
          }}
        />
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!sending && !closed) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          marginTop: 16,
          padding: "28px 18px",
          border: `1px dashed ${dragging ? "var(--ac)" : "var(--bdh)"}`,
          borderRadius: 2,
          background: dragging ? "rgba(57,255,106,.06)" : "transparent",
          textAlign: "center",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button type="button" style={{ ...button, opacity: sending || closed ? 0.45 : 1 }} disabled={sending || closed} onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <div style={{ marginTop: 10, color: "var(--t2)", fontSize: 12 }}>or drop them here</div>
      </div>

      <div aria-live="polite" style={{ marginTop: 16 }}>
        {state.phase === "picking" && picked.length > 0 ? (
          <div style={{ color: "var(--t1)", fontSize: 13 }}>
            {files(ready.length)} ready · {formatBytes(readyBytes)}
            {tooLarge > 0 ? <span style={{ color: "var(--t2)" }}> · {files(tooLarge)} over {maxFileSize} left out</span> : null}
            {overLimit > 0 ? <span style={{ color: "var(--t2)" }}> · {files(overLimit)} over the {UPLOAD_SELECTION_LIMIT}-file limit left out</span> : null}
          </div>
        ) : null}

        {state.phase === "sending" ? (
          <div>
            <div style={{ color: "var(--t1)", fontSize: 13 }}>
              Sending {state.done} of {files(state.total)}…
            </div>
            <div
              role="progressbar"
              aria-label="Sending files"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.progress * 100)}
              style={{ height: 4, marginTop: 8, background: "var(--bd)", borderRadius: 2, overflow: "hidden" }}
            >
              <div style={{ width: `${Math.round(state.progress * 100)}%`, height: "100%", background: "var(--ac)", transition: "width .2s" }} />
            </div>
          </div>
        ) : null}

        {outcome ? (
          <div role="status">
            <div style={{ color: "var(--t1)", fontSize: 15, fontWeight: 700 }}>{outcome.headline}</div>
            {outcome.detail ? <div style={{ marginTop: 4, color: "var(--t2)", fontSize: 12 }}>{outcome.detail}</div> : null}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        {state.phase === "finished" ? (
          retryable ? (
            <button type="button" style={primaryButton} onClick={() => void send(picked)}>
              Send {files(picked.length)} again
            </button>
          ) : !state.result.linkGone && !state.result.quotaReached ? (
            <button type="button" style={button} onClick={() => inputRef.current?.click()}>
              Send more files
            </button>
          ) : null
        ) : (
          <>
            <button
              type="button"
              style={{ ...primaryButton, opacity: ready.length && !sending ? 1 : 0.45 }}
              disabled={!ready.length || sending}
              onClick={() => void send(ready)}
            >
              <span aria-hidden="true">↑</span>
              {sending ? "Sending…" : ready.length ? `Send ${files(ready.length)}` : "Send files"}
            </button>
            {picked.length > 0 && !sending ? (
              <button type="button" style={{ ...button, borderColor: "transparent" }} onClick={() => setPicked([])}>
                Clear
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
