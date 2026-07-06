import type { ExpandFile } from "@/lib/layout";
import { OpenIcon, CloseIcon } from "@/components/icons/icons";

interface ExpandFileTileProps {
  file: ExpandFile;
  hovered: boolean;
  onDown: (e: React.PointerEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

/**
 * A single file in a Sense/Map drill-down overlay: draggable, with a hover
 * toolbar (open / delete). Deliberately has no position transition so dragging
 * tracks the pointer 1:1 (unlike the neural PhotoTile).
 */
export default function ExpandFileTile({
  file,
  hovered,
  onDown,
  onEnter,
  onLeave,
  onOpen,
  onDelete,
}: ExpandFileTileProps) {
  return (
    <div
      onPointerDown={onDown}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ position: "absolute", left: file.x, top: file.y, width: file.w, zIndex: hovered ? 30 : 22, cursor: "grab" }}
    >
      <div
        style={{
          position: "relative",
          borderRadius: 3,
          overflow: "hidden",
          border: "1px solid var(--bd)",
          background: "var(--bg-in)",
          boxShadow: "0 4px 16px rgba(0,0,0,.5)",
        }}
      >
        <div style={{ width: "100%", height: file.h, backgroundImage: `url(${file.src})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        {hovered && <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.24)", pointerEvents: "none" }} />}
      </div>
      {hovered && (
        <div
          style={{
            position: "absolute",
            top: -38,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 2,
            background: "rgba(20,20,20,.95)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            padding: 3,
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 24px rgba(0,0,0,.5)",
            zIndex: 5,
          }}
        >
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onOpen}
            aria-label="Open photo"
            style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--t2)", borderRadius: 2, cursor: "pointer" }}
          >
            <OpenIcon />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDelete}
            aria-label="Delete photo"
            style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--red)", borderRadius: 2, cursor: "pointer" }}
          >
            <CloseIcon width={13} height={13} strokeWidth={1.6} />
          </button>
        </div>
      )}
    </div>
  );
}
