import type { CSSProperties } from "react";
import { DownloadIcon, PencilIcon } from "@/components/icons/icons";

interface WorkspaceOutputActionsProps {
  draftCount: number;
  photoCount: number;
  selectedCount: number;
  onCreate: () => void;
  onDownload: () => void;
}

const BADGE: CSSProperties = { padding: "1px 5px", background: "rgba(5,5,5,.18)", borderRadius: 2, fontSize: 9.5, fontWeight: 800 };

const base: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  boxSizing: "border-box",
  height: 30,
  borderRadius: 2,
  padding: "0 10px",
  fontFamily: "inherit",
  fontSize: 11.5,
  fontWeight: 800,
  letterSpacing: ".04em",
};

/** A Workspace's two outcome doors (ADR 0045, 2026-10-27): one per job, each
 *  named for the window it opens.
 *
 *  It went three (Create / Drafts / Download) → two → one EXPORT door over a hub
 *  that held both jobs. That hub answered "what comes out of this Workspace" in
 *  one window, but the same Download was also reached straight from a photo, the
 *  drawer and the right-click menu — so one job had two first windows, and the
 *  hub path asked for the format twice. Now DOWNLOAD opens the one download
 *  dialog every other entry point opens, and CREATE opens the content hub alone.
 *
 *  DOWNLOAD is the primary and sits on the right edge, where ANALYZE sits
 *  outside a Workspace: the slot's green/purple button never moves between
 *  scopes. Like ANALYZE it is badged with the selection, because that is the
 *  set it downloads — the whole Workspace when nothing is selected. CREATE is
 *  quieter and carries the draft count, so it says whether there is unfinished
 *  work behind it without opening; it stays live when there are drafts but no
 *  files. */
export default function WorkspaceOutputActions({
  draftCount,
  photoCount,
  selectedCount,
  onCreate,
  onDownload,
}: WorkspaceOutputActionsProps) {
  const createLive = photoCount > 0 || draftCount > 0;
  const downloadLive = photoCount > 0;
  const downloadLabel = selectedCount
    ? `Download ${selectedCount} selected`
    : `Download all ${photoCount} ${photoCount === 1 ? "file" : "files"}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={onCreate}
        disabled={!createLive}
        aria-label={`Create${draftCount ? `, ${draftCount} draft${draftCount === 1 ? "" : "s"}` : ""}`}
        title="Create an article or a carousel from this Workspace"
        style={{
          ...base,
          background: "transparent",
          border: `1px solid ${createLive ? "var(--bdh)" : "var(--bd)"}`,
          color: createLive ? "var(--t1)" : "var(--tm)",
          cursor: createLive ? "pointer" : "default",
        }}
      >
        <PencilIcon width={12} height={12} strokeWidth={2} />
        CREATE
        {draftCount > 0 && <span style={{ ...BADGE, background: "var(--bd)" }}>{draftCount}</span>}
      </button>
      <button
        onClick={onDownload}
        disabled={!downloadLive}
        aria-label={downloadLabel}
        title={downloadLabel}
        style={{
          ...base,
          minWidth: 112,
          background: downloadLive ? "var(--ac)" : "var(--bd)",
          border: 0,
          color: downloadLive ? "#050505" : "var(--tm)",
          cursor: downloadLive ? "pointer" : "default",
        }}
      >
        <DownloadIcon width={12} height={12} strokeWidth={2} />
        DOWNLOAD
        {selectedCount > 0 && <span style={BADGE}>{selectedCount}</span>}
      </button>
    </div>
  );
}
