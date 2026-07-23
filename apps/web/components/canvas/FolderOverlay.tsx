import { useRef, useState } from "react";
import { FOLDER_TILE_H, FOLDER_TILE_W, type FolderModel } from "@/hooks/useWorkspace";
import { CloseIcon } from "@/components/icons/icons";

interface FolderOverlayProps {
  folders: FolderModel[];
  /** Canvas zoom, to convert screen-space drag deltas into content space. */
  scale: number;
  onToggle: (id: string) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

const DRAG_THRESHOLD = 3;

/** Folders (ADR 0034) rendered on the Canvas. Collapsed = a labelled thumbnail
 *  stack that stands in for its hidden members; expanded = a labelled region the
 *  member tiles sit inside (drawn behind them, like a frame). Server owns
 *  membership; this overlay only moves/renames/collapses the client geometry. */
export default function FolderOverlay({
  folders,
  scale,
  onToggle,
  onMove,
  onRename,
  onDelete,
}: FolderOverlayProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const drag = useRef<{ id: string; lastX: number; lastY: number; moved: boolean } | null>(null);

  const commitRename = () => {
    if (editingId) {
      const trimmed = draftLabel.trim();
      if (trimmed) onRename(editingId, trimmed);
    }
    setEditingId(null);
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't start a canvas pan / marquee
    drag.current = { id, lastX: e.clientX, lastY: e.clientY, moved: false };
    const onMoveWin = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.lastX;
      const dy = ev.clientY - d.lastY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      d.lastX = ev.clientX;
      d.lastY = ev.clientY;
      onMove(id, dx / scale, dy / scale);
    };
    const onUpWin = () => {
      window.removeEventListener("pointermove", onMoveWin);
      window.removeEventListener("pointerup", onUpWin);
      drag.current = null;
    };
    window.addEventListener("pointermove", onMoveWin);
    window.addEventListener("pointerup", onUpWin);
  };

  const labelChip = (f: FolderModel, dark: boolean) =>
    editingId === f.id ? (
      <input
        autoFocus
        value={draftLabel}
        onChange={(e) => setDraftLabel(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          else if (e.key === "Escape") setEditingId(null);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--t1)",
          letterSpacing: "0.02em",
          background: "var(--bg-el)",
          border: "1px solid var(--ac)",
          borderRadius: 2,
          padding: "1px 4px",
          width: Math.max(60, draftLabel.length * 7),
          fontFamily: "inherit",
          outline: "none",
        }}
      />
    ) : (
      <span
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditingId(f.id);
          setDraftLabel(f.name);
        }}
        title="Double-click to rename"
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: dark ? "var(--t1)" : "var(--t3)",
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          cursor: "text",
        }}
      >
        {f.name}
      </span>
    );

  return (
    <>
      {folders.map((f) =>
        f.geom.collapsed ? (
          // ── Collapsed: a folder tile standing in for its members ──
          <div
            key={f.id}
            onPointerDown={(e) => startDrag(e, f.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (editingId === f.id) return;
              onToggle(f.id);
            }}
            title="Double-click to open"
            style={{
              position: "absolute",
              left: f.geom.x,
              top: f.geom.y,
              width: FOLDER_TILE_W,
              height: FOLDER_TILE_H,
              background: "var(--bg-el)",
              border: "1px solid var(--bdh)",
              borderRadius: 4,
              zIndex: 1,
              cursor: "grab",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 2px 10px rgba(0,0,0,.35)",
            }}
          >
            <div style={{ position: "relative", flex: 1, background: "rgba(255,255,255,.03)" }}>
              {f.previews.length > 0 ? (
                f.previews.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt=""
                    draggable={false}
                    style={{
                      position: "absolute",
                      left: 12 + i * 14,
                      top: 10 + i * 8,
                      width: FOLDER_TILE_W - 48,
                      height: FOLDER_TILE_H - 58,
                      objectFit: "cover",
                      borderRadius: 3,
                      border: "1px solid var(--bd)",
                      boxShadow: "0 1px 4px rgba(0,0,0,.4)",
                    }}
                  />
                ))
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    color: "var(--t3)",
                  }}
                >
                  ▦
                </div>
              )}
              <span
                style={{
                  position: "absolute",
                  right: 6,
                  top: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--t1)",
                  background: "rgba(0,0,0,.55)",
                  borderRadius: 8,
                  padding: "1px 6px",
                }}
              >
                {f.count}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 7px",
                borderTop: "1px solid var(--bd)",
              }}
            >
              <span style={{ fontSize: 11, color: "var(--t3)" }}>📁</span>
              <div style={{ flex: 1, minWidth: 0 }}>{labelChip(f, true)}</div>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(f.id);
                }}
                title="Ungroup (delete folder)"
                aria-label="Ungroup folder"
                style={{
                  display: "flex",
                  width: 16,
                  height: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  border: 0,
                  borderRadius: 2,
                  background: "transparent",
                  color: "var(--t3)",
                  cursor: "pointer",
                }}
              >
                <CloseIcon width={9} height={9} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        ) : (
          // ── Expanded: a labelled region the member tiles sit inside ──
          <div
            key={f.id}
            style={{
              position: "absolute",
              left: f.geom.x,
              top: f.geom.y,
              width: f.geom.w,
              height: f.geom.h,
              border: "1px solid var(--bdh)",
              background: "rgba(255,255,255,0.012)",
              borderRadius: 4,
              zIndex: 0,
              pointerEvents: "none",
            }}
          >
            <div
              onPointerDown={(e) => startDrag(e, f.id)}
              style={{
                position: "absolute",
                left: 0,
                top: -26,
                display: "flex",
                alignItems: "center",
                gap: 6,
                pointerEvents: "auto",
                cursor: "grab",
              }}
            >
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(f.id);
                }}
                title="Collapse folder"
                aria-label="Collapse folder"
                style={{
                  display: "flex",
                  width: 16,
                  height: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  border: 0,
                  borderRadius: 2,
                  background: "var(--bg-el)",
                  color: "var(--t2)",
                  cursor: "pointer",
                  fontSize: 10,
                }}
              >
                ▾
              </button>
              {labelChip(f, false)}
              <span style={{ fontSize: 10, color: "var(--t3)" }}>{f.count}</span>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(f.id);
                }}
                title="Ungroup (delete folder)"
                aria-label="Ungroup folder"
                style={{
                  display: "flex",
                  width: 16,
                  height: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  border: 0,
                  borderRadius: 2,
                  background: "var(--bg-el)",
                  color: "var(--t3)",
                  cursor: "pointer",
                  opacity: 0.85,
                }}
              >
                <CloseIcon width={9} height={9} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        ),
      )}
    </>
  );
}
