import { Z } from "@/lib/ui";

interface CanvasContextMenuProps {
  menu: { x: number; y: number; targetId: string | null } | null;
  /** Hide the project-editing tools (frame/AI/import) that don't apply to the
   *  read-only all-files grid — matches the left toolbar's own gating. */
  allFilesMode: boolean;
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
  onDelete: () => void;
  onFit: () => void;
}

/** Right-click menu on the grid — mirrors the functions of the left tools
 *  toolbar (not the bottom action bar). Available on the Workspace and the
 *  sorting views. */
export default function CanvasContextMenu({
  menu,
  allFilesMode,
  selCount,
  onClose,
  onSelectTool,
  onHandTool,
  onToggleChat,
  onToggleBulkPanel,
  onExtractExif,
  onAdd,
  onAddStickyNote,
  onDelete,
  onFit,
}: CanvasContextMenuProps) {
  if (!menu) return null;
  const deletable = !allFilesMode && (selCount > 0 || menu.targetId != null);

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
        <Item label="Select" onClick={run(onSelectTool)} />
        <Item label="Pan" onClick={run(onHandTool)} />
        {!allFilesMode && (
          <>
            <Divider />
            <Item label="Smart Search" onClick={run(onToggleChat)} />
            <Item label="Generate Captions" onClick={run(onToggleBulkPanel)} />
            <Item label="Extract EXIF" onClick={run(onExtractExif)} />
            <Divider />
            <Item label="Add" onClick={run(onAdd)} />
            <Item label="Sticky Note" onClick={run(onAddStickyNote)} />
          </>
        )}
        {allFilesMode && (
          <>
            <Divider />
            <Item label="Smart Search" onClick={run(onToggleChat)} />
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
