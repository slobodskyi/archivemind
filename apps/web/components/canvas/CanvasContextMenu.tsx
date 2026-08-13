import type { AssetLabel, LabelNames } from "@archivemind/shared";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
import { Z } from "@/lib/ui";

interface CanvasContextMenuProps {
  menu: { x: number; y: number; targetId: string | null } | null;
  /** Hide project-editing tools (AI/import) that don't apply to the
   *  read-only all-files grid — matches the left toolbar's own gating. */
  allFilesMode: boolean;
  /** The Workspace (neural) view is showing. A sticky note's position is in
   *  Workspace coordinates, so it is only offered there — same rule the left
   *  toolbar and folder overlay follow. */
  isCanvasView: boolean;
  /** Current selection size — with a selection, "Move to Trash" acts on it;
   *  without one it acts on the right-clicked tile (menu.targetId). */
  selCount: number;
  onClose: () => void;
  onSelectTool: () => void;
  onHandTool: () => void;
  /** Opens the Smart Search panel (ChatPanel) — the single search entry point. */
  onToggleChat: () => void;
  onToggleBulkPanel: () => void;
  onExtractExif: () => void;
  onAdd: () => void;
  onAddStickyNote: () => void;
  /** Link the copied files into the archive being viewed. */
  onPaste: () => void;
  /** Files sitting on the Copy clipboard — 0 hides the Paste entry. */
  clipboardCount: number;
  /** Bind the selection into a move-/edit-together group (needs ≥ 2 selected). */
  onGroup: () => void;
  /** Folder and Export moved onto the Workspace bar, which only exists inside an
   *  open Workspace now — so a selection outside one reaches them here or not at
   *  all. Tidy up is deliberately not mirrored: it arranges the working surface,
   *  which is the thing a Workspace is. */
  onFolder: () => void;
  onExport: () => void;
  /** Dissolve the bound group(s) the selection touches. */
  onUngroup: () => void;
  /** The selection overlaps a bound group — show Ungroup instead of Group. */
  hasGroup: boolean;
  /** Layer order for the selection / right-clicked tile. */
  onBringToFront: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
  onFit: () => void;
  /** Colour labels: the swatch row sits at the TOP of the menu, exactly where
   *  Finder puts it — this is the highest-frequency action on a photo archive
   *  and it should never be a submenu. */
  labelNames: LabelNames;
  /** The colour the target already carries (`"mixed"` for a disagreeing
   *  selection), so the row can ring it. */
  currentLabel: AssetLabel | "mixed" | null;
  onPickLabel: (label: AssetLabel | null) => void;
}

/** Right-click menu on the grid — mirrors the functions of the left tools
 *  toolbar (not the bottom action bar). Available on the Workspace and the
 *  sorting views. */
export default function CanvasContextMenu({
  menu,
  allFilesMode,
  isCanvasView,
  selCount,
  onClose,
  onSelectTool,
  onHandTool,
  onToggleChat,
  onToggleBulkPanel,
  onExtractExif,
  onAdd,
  onAddStickyNote,
  onPaste,
  clipboardCount,
  onGroup,
  onFolder,
  onExport,
  onUngroup,
  hasGroup,
  onBringToFront,
  onBringForward,
  onSendBackward,
  onSendToBack,
  onDelete,
  onFit,
  labelNames,
  currentLabel,
  onPickLabel,
}: CanvasContextMenuProps) {
  if (!menu) return null;
  const deletable = !allFilesMode && (selCount > 0 || menu.targetId != null);
  // Labels are curation, not project editing — they work on the read-only
  // all-files grid too, which is where an untriaged pile usually is.
  const labelable = selCount > 0 || menu.targetId != null;
  const canGroup = !allFilesMode && (hasGroup || selCount >= 2);
  // Layer order applies to the selection, or the single right-clicked tile.
  const canLayer = !allFilesMode && (selCount > 0 || menu.targetId != null);
  // Paste links copied files into THIS archive, so it is meaningless on the
  // workspace-wide 'all' canvas, which has no membership to add to.
  const canPaste = !allFilesMode && clipboardCount > 0;

  const W = 190;
  const left = typeof window !== "undefined" ? Math.min(menu.x, window.innerWidth - W - 8) : menu.x;
  const top = typeof window !== "undefined" ? Math.min(menu.y, window.innerHeight - 320) : menu.y;

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <>
      <div
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        style={{ position: "fixed", inset: 0, zIndex: Z.menuBackdrop }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left,
          top,
          width: W,
          background: "rgba(18,18,18,.97)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          backdropFilter: "blur(20px)",
          boxShadow: "0 20px 60px rgba(0,0,0,.7)",
          zIndex: Z.menu,
          padding: 6,
        }}
      >
        {labelable && (
          <>
            <LabelSwatchRow
              names={labelNames}
              current={currentLabel}
              onPick={(label) => {
                onClose();
                onPickLabel(label);
              }}
            />
            <Divider />
          </>
        )}
        <Item label="Select" onClick={run(onSelectTool)} />
        <Item label="Pan" onClick={run(onHandTool)} />
        {!allFilesMode && (
          <>
            <Divider />
            <Item label="Smart Search" onClick={run(onToggleChat)} />
            <Item label="AI actions" onClick={run(onToggleBulkPanel)} />
            <Item label="Extract EXIF" onClick={run(onExtractExif)} />
            <Divider />
            <Item label="Add" onClick={run(onAdd)} />
            {isCanvasView && <Item label="Sticky Note" onClick={run(onAddStickyNote)} />}
          </>
        )}
        {allFilesMode && (
          <>
            <Divider />
            <Item label="Smart Search" onClick={run(onToggleChat)} />
          </>
        )}
        {canLayer && (
          <>
            <Divider />
            <Item label="Bring to front" onClick={run(onBringToFront)} />
            <Item label="Bring forward" onClick={run(onBringForward)} />
            <Item label="Send backward" onClick={run(onSendBackward)} />
            <Item label="Send to back" onClick={run(onSendToBack)} />
          </>
        )}
        {canPaste && (
          <>
            <Divider />
            <Item label={`Paste ${clipboardCount} here`} onClick={run(onPaste)} />
          </>
        )}
        {canGroup && (
          <>
            <Divider />
            {hasGroup ? (
              <Item label="Ungroup" onClick={run(onUngroup)} />
            ) : (
              <Item label={`Group ${selCount}`} onClick={run(onGroup)} />
            )}
            <Item label="Put in folder" onClick={run(onFolder)} />
            <Item label={selCount > 1 ? `Export ${selCount}` : "Export"} onClick={run(onExport)} />
          </>
        )}
        {deletable && (
          <>
            <Divider />
            <Item
              label={selCount > 1 ? `Move ${selCount} to Trash` : "Move to Trash"}
              danger
              onClick={run(onDelete)}
            />
          </>
        )}
        <Divider />
        <Item label="Fit to view" onClick={run(onFit)} />
      </div>
    </>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--bd)", margin: "5px 4px" }} />;
}

function Item({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        padding: "8px 10px",
        border: 0,
        borderRadius: 2,
        cursor: "pointer",
        fontFamily: "inherit",
        color: danger ? "var(--red)" : "var(--t2)",
        fontSize: 12.5,
        background: "transparent",
        textAlign: "left",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}
