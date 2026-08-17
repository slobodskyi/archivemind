interface WorkspaceOutputActionsProps {
  draftCount: number;
  photoCount: number;
  selectedCount: number;
  onOpenDrafts: () => void;
  onDownload: () => void;
  onCreate: () => void;
}

import { LogsIcon, DownloadIcon } from "@/components/icons/icons";

const base = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  height: 30,
  borderRadius: 2,
  padding: "0 10px",
  fontFamily: "inherit",
  fontSize: 11.5,
  cursor: "pointer",
} as const;

/** Outcome-first Workspace actions. Create makes content, Download gets the
 * source files, and Drafts returns to material that can still be edited. */
export default function WorkspaceOutputActions({
  draftCount,
  photoCount,
  selectedCount,
  onOpenDrafts,
  onDownload,
  onCreate,
}: WorkspaceOutputActionsProps) {
  const sourceCount = selectedCount || photoCount;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={onOpenDrafts}
        aria-label={`Drafts${draftCount ? `, ${draftCount}` : ""}`}
        style={{ ...base, background: "transparent", border: "1px solid var(--bd)", color: "var(--t2)" }}
      >
        {/* The icons exist for the phone, where the two secondary actions drop
            their words: on a 390px header row these three cost ~220px, which
            leaves the workspace chips beside them too little to show a name.
            Create keeps its label at every size — it is the primary action and
            an unlabelled glyph for "make a publication" would be a guess. */}
        <LogsIcon width={12} height={12} />
        <span className="am-wsa-label">DRAFTS{draftCount ? ` ${draftCount}` : ""}</span>
      </button>
      <button
        onClick={onDownload}
        disabled={sourceCount === 0}
        aria-label={selectedCount ? `Download selected ${selectedCount}` : `Download all ${photoCount}`}
        title={selectedCount ? `Download selected ${selectedCount}` : `Download all ${photoCount}`}
        style={{
          ...base,
          background: "transparent",
          border: "1px solid var(--bd)",
          color: sourceCount ? "var(--t2)" : "var(--tm)",
          cursor: sourceCount ? "pointer" : "default",
        }}
      >
        <DownloadIcon width={12} height={12} />
        <span className="am-wsa-label">DOWNLOAD{selectedCount ? ` ${selectedCount}` : ""}</span>
      </button>
      <button
        onClick={onCreate}
        disabled={sourceCount === 0}
        title={selectedCount ? `Create from selected ${selectedCount}` : `Create from all ${photoCount}`}
        style={{
          ...base,
          minWidth: 72,
          background: sourceCount ? "var(--ac)" : "var(--bd)",
          border: 0,
          color: sourceCount ? "#050505" : "var(--tm)",
          fontWeight: 800,
          letterSpacing: ".04em",
          cursor: sourceCount ? "pointer" : "default",
        }}
      >
        CREATE
      </button>
    </div>
  );
}
