interface WorkspaceOutputActionsProps {
  draftCount: number;
  photoCount: number;
  selectedCount: number;
  onDownload: () => void;
  onCreate: () => void;
}

import { DownloadIcon } from "@/components/icons/icons";

const base = {
  display: "flex",
  alignItems: "center",
  // Centred content on a shared width floor, so the two buttons read as one pair
  // and their labels sit centred rather than left-packed behind an icon. A floor
  // rather than a fixed width: DOWNLOAD carries the selection count, and at two
  // digits a hard 112 would push the label past its own border. Below 760px
  // `.am-wsactions button` drops it to 0 and the labels become icons.
  justifyContent: "center",
  gap: 5,
  minWidth: 112,
  boxSizing: "border-box",
  height: 30,
  borderRadius: 2,
  padding: "0 10px",
  fontFamily: "inherit",
  fontSize: 11.5,
  cursor: "pointer",
} as const;

/** Outcome-first Workspace actions (ADR 0045 as amended): two, not three.
 * Download gets the source files; Create opens the hub, which holds both the
 * outcome cards and the saved drafts — the separate DRAFTS button folded into
 * it, and its count rides on Create as a badge. */
export default function WorkspaceOutputActions({
  draftCount,
  photoCount,
  selectedCount,
  onDownload,
  onCreate,
}: WorkspaceOutputActionsProps) {
  const sourceCount = selectedCount || photoCount;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
        {/* The icon exists for the phone, where the secondary action drops its
            word: on a 390px row these buttons compete with the photos beneath.
            Create keeps its label at every size — it is the primary action and
            an unlabelled glyph for "make a publication" would be a guess. */}
        <DownloadIcon width={12} height={12} />
        <span className="am-wsa-label">DOWNLOAD{selectedCount ? ` ${selectedCount}` : ""}</span>
      </button>
      <button
        onClick={onCreate}
        disabled={sourceCount === 0 && draftCount === 0}
        aria-label={`Create${draftCount ? `, ${draftCount} draft${draftCount === 1 ? "" : "s"}` : ""}`}
        title={selectedCount ? `Create from selected ${selectedCount}` : `Create from all ${photoCount}`}
        style={{
          ...base,
          background: sourceCount || draftCount ? "var(--ac)" : "var(--bd)",
          border: 0,
          color: sourceCount || draftCount ? "#050505" : "var(--tm)",
          fontWeight: 800,
          letterSpacing: ".04em",
          cursor: sourceCount || draftCount ? "pointer" : "default",
        }}
      >
        CREATE
        {draftCount > 0 && (
          <span style={{ padding: "1px 5px", background: "rgba(5,5,5,.18)", borderRadius: 2, fontSize: 9.5, fontWeight: 800 }}>
            {draftCount}
          </span>
        )}
      </button>
    </div>
  );
}
