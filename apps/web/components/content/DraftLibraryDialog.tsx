"use client";

import { useId } from "react";
import type { ContentDraft } from "@/lib/content-drafts";
import { sourcesChanged } from "@/lib/content-drafts";
import { useDialog } from "@/hooks/useDialog";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";

interface DraftLibraryDialogProps {
  open: boolean;
  boardName: string;
  drafts: ContentDraft[];
  currentAssetIds: string[];
  onClose: () => void;
  onCreate: () => void;
  onOpenDraft: (draft: ContentDraft) => void;
}

export default function DraftLibraryDialog({
  open,
  boardName,
  drafts,
  currentAssetIds,
  onClose,
  onCreate,
  onOpenDraft,
}: DraftLibraryDialogProps) {
  const titleId = useId();
  const dialogRef = useDialog<HTMLDivElement>(open, onClose);
  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: Z.modal, display: "flex", alignItems: "center", justifyContent: "center", background: MODAL_BACKDROP, backdropFilter: MODAL_BLUR }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
        style={{ width: "min(600px, calc(100vw - 32px))", maxHeight: "min(680px, calc(100dvh - 40px))", display: "flex", flexDirection: "column", background: "var(--bg-sf)", border: "1px solid var(--bdh)", borderRadius: 2, boxShadow: "0 32px 80px rgba(0,0,0,.7)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 20px", borderBottom: "1px solid var(--bd)" }}>
          <div>
            <div id={titleId} style={{ color: "var(--t1)", fontSize: 15, fontWeight: 800 }}>Drafts · {boardName}</div>
            <div style={{ marginTop: 4, color: "var(--t3)", fontSize: 10.5 }}>Saved in this browser · source snapshots never change silently</div>
          </div>
          <button data-autofocus="" onClick={onCreate} disabled={currentAssetIds.length === 0} style={{ height: 32, padding: "0 12px", border: 0, borderRadius: 2, background: currentAssetIds.length ? "var(--ac)" : "var(--bd)", color: currentAssetIds.length ? "#050505" : "var(--tm)", fontFamily: "inherit", fontSize: 11.5, fontWeight: 800, cursor: currentAssetIds.length ? "pointer" : "default" }}>+ Create</button>
        </div>

        <div style={{ minHeight: 180, overflow: "auto", padding: 12 }}>
          {drafts.length === 0 ? (
            <div style={{ padding: "42px 20px", textAlign: "center" }}>
              <div style={{ color: "var(--t1)", fontSize: 13, fontWeight: 700 }}>Turn these photos into something publishable</div>
              <div style={{ marginTop: 6, color: "var(--t3)", fontSize: 11.5 }}>Create an article or an Instagram carousel. You can edit every generated word.</div>
            </div>
          ) : (
            drafts.map((draft) => {
              const changed = sourcesChanged(draft.sourceSnapshot, currentAssetIds);
              return (
                <button
                  key={draft.id}
                  onClick={() => onOpenDraft(draft)}
                  style={{ width: "100%", display: "grid", gridTemplateColumns: "46px 1fr auto", alignItems: "center", gap: 12, marginBottom: 6, padding: "10px 12px", background: "var(--bg-el)", border: "1px solid var(--bd)", borderRadius: 2, color: "inherit", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, background: "var(--bg)", border: "1px solid var(--bd)", color: "var(--t3)", fontSize: 9, fontWeight: 800, letterSpacing: ".04em" }}>{draft.kind === "article" ? "ARTICLE" : "IG"}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t1)", fontSize: 12.5, fontWeight: 700 }}>{draft.name}</span>
                    <span style={{ display: "block", marginTop: 4, color: "var(--t3)", fontSize: 10.5 }}>{draft.sourceSnapshot.assetIds.length} sources · edited {new Date(draft.updatedAt).toLocaleDateString()}</span>
                  </span>
                  {changed ? <span style={{ padding: "4px 6px", background: "rgba(255,184,77,.1)", border: "1px solid rgba(255,184,77,.35)", color: "#ffbd66", fontSize: 9.5, whiteSpace: "nowrap" }}>Sources changed</span> : <span style={{ color: "var(--t3)", fontSize: 15 }}>›</span>}
                </button>
              );
            })
          )}
        </div>
        <div style={{ padding: "0 12px 12px" }}>
          <button onClick={onClose} style={{ width: "100%", height: 34, background: "transparent", border: "1px solid var(--bd)", borderRadius: 2, color: "var(--t2)", fontFamily: "inherit", cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}
