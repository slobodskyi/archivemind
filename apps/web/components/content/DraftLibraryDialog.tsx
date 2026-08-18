"use client";

import type { ContentDraft } from "@/lib/content-drafts";
import { sourcesChanged } from "@/lib/content-drafts";
import Dialog from "@/components/modals/Dialog";

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
  return (
    <Dialog
      open={open}
      size="l"
      kicker="Drafts"
      title={boardName}
      subtitle="Saved with this Workspace · source snapshots never change silently"
      headerAction={
        <button
          data-autofocus=""
          onClick={onCreate}
          disabled={currentAssetIds.length === 0}
          style={{ height: 32, padding: "0 12px", border: 0, borderRadius: 2, background: currentAssetIds.length ? "var(--ac)" : "var(--bd)", color: currentAssetIds.length ? "#050505" : "var(--tm)", fontFamily: "inherit", fontSize: 11.5, fontWeight: 800, cursor: currentAssetIds.length ? "pointer" : "default" }}
        >
          + Create
        </button>
      }
      onClose={onClose}
      bodyStyle={{ minHeight: 180, padding: 12 }}
    >
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
    </Dialog>
  );
}
