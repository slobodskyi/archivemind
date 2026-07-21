import { useState } from "react";
import { Z } from "@/lib/ui";
import type { Frame } from "@/lib/layout";

interface CanvasContextMenuProps {
  menu: { x: number; y: number; targetId: string | null } | null;
  frames: Frame[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onAddToProject: () => void;
  onAddToNewArtboard: () => void;
  onAddToExistingArtboard: (frameId: string) => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onGroup: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/** Right-click menu on the grid — same actions as the Workspace action bar,
 *  plus Open, Add to project, and the new "Add to artboard" submenu. Available
 *  on both the Workspace and the sorting views. */
export default function CanvasContextMenu({
  menu,
  frames,
  onClose,
  onOpen,
  onAddToProject,
  onAddToNewArtboard,
  onAddToExistingArtboard,
  onCopy,
  onDuplicate,
  onExport,
  onGroup,
  onArchive,
  onDelete,
}: CanvasContextMenuProps) {
  const [artboardOpen, setArtboardOpen] = useState(false);
  if (!menu) return null;

  // Keep the panel on-screen when the click lands near the right/bottom edge.
  const W = 190;
  const left = typeof window !== "undefined" ? Math.min(menu.x, window.innerWidth - W - 8) : menu.x;
  const top = typeof window !== "undefined" ? Math.min(menu.y, window.innerHeight - 340) : menu.y;

  const close = () => {
    setArtboardOpen(false);
    onClose();
  };

  return (
    <>
      <div
        onClick={close}
        onContextMenu={(e) => {
          e.preventDefault();
          close();
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
        {menu.targetId && <Item label="Open" onClick={() => { close(); onOpen(menu.targetId as string); }} />}
        <Item label="Add to project" onClick={() => { close(); onAddToProject(); }} />

        <Item
          label="Add to artboard"
          chevron={artboardOpen ? "▾" : "▸"}
          onClick={() => setArtboardOpen((v) => !v)}
        />
        {artboardOpen && (
          <div style={{ margin: "2px 0 4px", paddingLeft: 8, borderLeft: "1px solid var(--bd)" }}>
            <Item label="New artboard" onClick={() => { close(); onAddToNewArtboard(); }} />
            {frames.map((f) => (
              <Item key={f.id} label={f.label} onClick={() => { close(); onAddToExistingArtboard(f.id); }} />
            ))}
            {frames.length === 0 && (
              <div style={{ padding: "6px 10px", fontSize: 11.5, color: "var(--tm)" }}>No artboards yet</div>
            )}
          </div>
        )}

        <Divider />
        <Item label="Copy" onClick={() => { close(); onCopy(); }} />
        <Item label="Duplicate" onClick={() => { close(); onDuplicate(); }} />
        <Item label="Export" onClick={() => { close(); onExport(); }} />
        <Item label="Group" onClick={() => { close(); onGroup(); }} />
        <Item label="Archive" onClick={() => { close(); onArchive(); }} />
        <Divider />
        <Item label="Delete" danger onClick={() => { close(); onDelete(); }} />
      </div>
    </>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--bd)", margin: "5px 4px" }} />;
}

function Item({
  label,
  onClick,
  danger,
  chevron,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  chevron?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
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
      {chevron && <span style={{ flex: "0 0 auto", color: "var(--t3)" }}>{chevron}</span>}
    </button>
  );
}
