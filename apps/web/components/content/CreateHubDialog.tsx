"use client";

import type { ContentDraft } from "@/lib/content-drafts";
import { sourcesChanged } from "@/lib/content-drafts";
import Dialog from "@/components/modals/Dialog";

interface CreateHubDialogProps {
  open: boolean;
  boardName: string;
  drafts: ContentDraft[];
  currentAssetIds: string[];
  onClose: () => void;
  onPickKind: (kind: "article" | "instagram_carousel") => void;
  onOpenDraft: (draft: ContentDraft) => void;
}

const sectionLabel = {
  display: "block",
  margin: "18px 0 8px",
  color: "var(--t3)",
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: ".08em",
  textTransform: "uppercase",
} as const;

/** The single entry into making content from a Workspace (ADR 0045 as
 * amended): pick an outcome, or continue a saved draft. It replaced the
 * separate DRAFTS and CREATE buttons — the library IS where creating starts,
 * which its own "+ Create" header button had already admitted. */
export default function CreateHubDialog({
  open,
  boardName,
  drafts,
  currentAssetIds,
  onClose,
  onPickKind,
  onOpenDraft,
}: CreateHubDialogProps) {
  const canCreate = currentAssetIds.length > 0;
  return (
    <Dialog
      open={open}
      size="l"
      kicker="Create"
      title={boardName}
      subtitle="Turn this Workspace's files into something publishable. Every generated word stays editable."
      onClose={onClose}
      bodyStyle={{ padding: "16px 20px 20px" }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {([
          ["article", "Article", "Narrative copy with ordered images"],
          ["instagram_carousel", "Instagram carousel", "Phone-sized story sequence + caption"],
        ] as const).map(([value, label, help], index) => (
          <button
            key={value}
            data-autofocus={index === 0 ? "" : undefined}
            onClick={() => onPickKind(value)}
            disabled={!canCreate}
            style={{
              padding: "15px 14px",
              textAlign: "left",
              background: "var(--bg-el)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              cursor: canCreate ? "pointer" : "default",
              opacity: canCreate ? 1 : 0.45,
              fontFamily: "inherit",
            }}
          >
            <span style={{ display: "block", color: "var(--t1)", fontSize: 13, fontWeight: 700 }}>{label}</span>
            <span style={{ display: "block", marginTop: 4, color: "var(--t3)", fontSize: 10.5 }}>{help}</span>
          </button>
        ))}
      </div>
      {!canCreate && (
        <div style={{ marginTop: 8, color: "var(--t3)", fontSize: 10.5 }}>
          This Workspace has no files yet — add some to create from them.
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <span style={sectionLabel}>Continue editing</span>
          {drafts.map((draft) => {
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
          })}
        </>
      )}
    </Dialog>
  );
}
