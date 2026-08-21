import { useEffect, useRef, useState } from "react";
import { boardChipAt } from "@/lib/board-drop";
import { createPortal } from "react-dom";
import { FOLDER_TILE_H, FOLDER_TILE_W, type FolderModel } from "@/hooks/useWorkspace";
import { CloseIcon } from "@/components/icons/icons";
import { MenuDivider, MenuItem, MenuPanel } from "@/components/canvas/CanvasContextMenu";

interface FolderOverlayProps {
  folders: FolderModel[];
  /** Canvas zoom, to convert screen-space drag deltas into content space. */
  scale: number;
  /** The folder whose dropdown is open (double-click), or null. */
  openFolderId: string | null;
  /** Double-click a folder → open its dropdown (double-click again closes it). */
  onOpen: (id: string) => void;
  onClose: () => void;
  /** Open a member photo in the drawer (also closes the dropdown). */
  onOpenPhoto: (id: string) => void;
  /** Drag a member out of the dropdown onto the Canvas at screen (x, y). */
  onDropMemberOut: (folderId: string, assetId: string, clientX: number, clientY: number) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  /** A folder was dropped onto a Workspace chip (ADR 0044). The folder drives
   *  its own window listeners rather than the canvas drag session, so it does
   *  its own chip hit-test — same helper, same rule. */
  onDropOnBoard?: (boardId: string, folderId: string) => void;
  /** Report the chip the drag is over so the header can arm it. */
  onBoardHover?: (boardId: string | null) => void;
  onRename: (id: string, name: string) => void;
  /** Dissolve the folder and put its files back on the canvas where it sits. */
  onUngroup: (id: string) => void;
}

const DRAG_THRESHOLD = 3;

/* Minimal folder silhouette (content-space px). Two brand greens carry the
   depth — dark green back + tab, bright green front flap — so no borders or
   highlight lines are needed. A slice of the member photos peeks out between
   the back and the front. */
const TAB_W = 58;
const TAB_H = 17;
const BACK_TOP = 12;
const FRONT_TOP = 46;
const R = 3;
const GREEN_BACK = "var(--ac2)";
const GREEN_FRONT = "var(--ac)";
const ON_GREEN = "#052b12";

/** Folders (ADR 0034) rendered on the Canvas as a folder-shaped tile that stands
 *  in for its hidden members. Double-click opens a dropdown of its contents
 *  attached to the folder. Server owns membership; geometry is client-side. */
export default function FolderOverlay({
  folders,
  scale,
  openFolderId,
  onOpen,
  onClose,
  onOpenPhoto,
  onDropMemberOut,
  onMove,
  onDropOnBoard,
  onBoardHover,
  onRename,
  onUngroup,
}: FolderOverlayProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Right-click menu for one folder. Local, not hoisted into the workspace
  // state: it is opened, read and closed entirely in here, and its own backdrop
  // means it and the canvas menu can never be open together.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{
    id: string;
    lastX: number;
    lastY: number;
    moved: boolean;
    totalX: number;
    totalY: number;
  } | null>(null);

  const startRename = (f: FolderModel) => {
    setEditingId(f.id);
    setDraftLabel(f.name);
  };

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
    drag.current = { id, lastX: e.clientX, lastY: e.clientY, moved: false, totalX: 0, totalY: 0 };
    const onMoveWin = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.lastX;
      const dy = ev.clientY - d.lastY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      d.lastX = ev.clientX;
      d.lastY = ev.clientY;
      // Totals, so a drop on a chip can put the folder back exactly where it
      // was picked up: the moves are applied incrementally and there is no
      // origin to fall back to otherwise.
      d.totalX += dx;
      d.totalY += dy;
      onBoardHover?.(boardChipAt(ev.clientX, ev.clientY));
      onMove(id, dx / scale, dy / scale);
    };
    const onUpWin = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMoveWin);
      window.removeEventListener("pointerup", onUpWin);
      const d = drag.current;
      drag.current = null;
      onBoardHover?.(null);
      const boardId = boardChipAt(ev.clientX, ev.clientY);
      if (d && boardId && onDropOnBoard) {
        // A change of owner, not of position — undo the whole drag.
        onMove(id, -d.totalX / scale, -d.totalY / scale);
        onDropOnBoard(boardId, id);
      }
    };
    window.addEventListener("pointermove", onMoveWin);
    window.addEventListener("pointerup", onUpWin);
  };

  return (
    <>
      {folders.map((f) => {
        const hovered = hoveredId === f.id;
        return (
          <div key={f.id}>
            <div
              onPointerDown={(e) => startDrag(e, f.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (editingId === f.id) return;
                // Double-click toggles: open it, or close it if it's already open.
                if (openFolderId === f.id) onClose();
                else onOpen(f.id);
              }}
              onContextMenu={(e) => {
                // Stop it here or it bubbles to the canvas, which would answer a
                // right-click on a folder with the tile menu — labels, layer
                // order and Trash, none of which a folder has.
                e.preventDefault();
                e.stopPropagation();
                setMenu({ id: f.id, x: e.clientX, y: e.clientY });
              }}
              onMouseEnter={() => setHoveredId(f.id)}
              onMouseLeave={() => setHoveredId((h) => (h === f.id ? null : h))}
              title="Double-click to open · right-click for more"
              style={{
                position: "absolute",
                left: f.geom.x,
                top: f.geom.y,
                width: FOLDER_TILE_W,
                height: FOLDER_TILE_H,
                zIndex: 1,
                cursor: "grab",
                filter: "drop-shadow(0 3px 10px rgba(0,0,0,.4))",
              }}
            >
              {/* Back + tab (dark green rear) */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: TAB_W,
                  height: TAB_H + R,
                  background: GREEN_BACK,
                  clipPath: "polygon(0 0, 76% 0, 100% 100%, 0 100%)",
                  borderTopLeftRadius: R,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: BACK_TOP,
                  bottom: 0,
                  background: GREEN_BACK,
                  borderRadius: R,
                }}
              />

              {/* Member photos peeking out of the top */}
              <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: R }}>
                {f.previews.length > 0 ? (
                  f.previews.map((src, i) => {
                    const n = f.previews.length;
                    const mid = (n - 1) / 2;
                    const rot = (i - mid) * 5;
                    const dx = (i - mid) * 12;
                    const pw = FOLDER_TILE_W - 52;
                    const ph = 58;
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt=""
                        draggable={false}
                        style={{
                          position: "absolute",
                          left: (FOLDER_TILE_W - pw) / 2 + dx,
                          top: FRONT_TOP - ph + 22 - Math.abs(i - mid) * 2,
                          width: pw,
                          height: ph,
                          objectFit: "cover",
                          borderRadius: R,
                          boxShadow: "0 2px 6px rgba(0,0,0,.45)",
                          transform: `rotate(${rot}deg)`,
                          transformOrigin: "bottom center",
                          zIndex: i,
                        }}
                      />
                    );
                  })
                ) : null}
              </div>

              {/* Front flap (bright green; carries the label) */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: FRONT_TOP,
                  bottom: 0,
                  background: GREEN_FRONT,
                  borderRadius: R,
                  boxShadow: "0 -1px 3px rgba(0,0,0,.18)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingId === f.id ? (
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
                          width: "100%",
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: ON_GREEN,
                          background: "rgba(255,255,255,.35)",
                          border: 0,
                          borderRadius: 2,
                          padding: "1px 4px",
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startRename(f);
                        }}
                        title="Double-click to rename"
                        style={{
                          display: "block",
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: ON_GREEN,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          cursor: "text",
                        }}
                      >
                        {f.name}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(5,43,18,.7)", flex: "0 0 auto" }}>{f.count}</span>
                  {/* Ungroup shows on hover only — keeps the resting folder clean. */}
                  {hovered && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUngroup(f.id);
                      }}
                      title="Ungroup — put the files back on the canvas"
                      aria-label="Ungroup folder"
                      style={{
                        display: "flex",
                        width: 15,
                        height: 15,
                        alignItems: "center",
                        justifyContent: "center",
                        border: 0,
                        borderRadius: 2,
                        background: "transparent",
                        color: ON_GREEN,
                        cursor: "pointer",
                        flex: "0 0 auto",
                      }}
                    >
                      <CloseIcon width={9} height={9} strokeWidth={2.4} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {openFolderId === f.id && (
              <FinderDropdown folder={f} onClose={onClose} onOpenPhoto={onOpenPhoto} onDropMemberOut={onDropMemberOut} />
            )}

            {/* Portalled to <body>: this panel is `position: fixed`, and the
                canvas content div it would otherwise live in carries a
                transform — which makes it the containing block for fixed
                descendants, so the menu would land at the wrong end of the
                zoom instead of under the cursor. */}
            {menu?.id === f.id &&
              typeof document !== "undefined" &&
              createPortal(
                <MenuPanel x={menu.x} y={menu.y} height={170} onClose={() => setMenu(null)}>
                  <MenuItem
                    label="Open"
                    onClick={() => {
                      setMenu(null);
                      if (openFolderId !== f.id) onOpen(f.id);
                    }}
                  />
                  <MenuItem
                    label="Rename"
                    onClick={() => {
                      setMenu(null);
                      startRename(f);
                    }}
                  />
                  <MenuDivider />
                  {/* The folder goes, the files stay — they land back on the
                      canvas where the folder sat. Nothing here deletes a photo,
                      so nothing here is danger-red. */}
                  <MenuItem
                    label={f.count > 0 ? `Ungroup ${f.count} ${f.count === 1 ? "file" : "files"}` : "Delete folder"}
                    onClick={() => {
                      setMenu(null);
                      onUngroup(f.id);
                    }}
                  />
                </MenuPanel>,
                document.body,
              )}
          </div>
        );
      })}
    </>
  );
}

/** The folder's contents, as a dropdown attached to it (content-space, so it
 *  drops down from the folder and pans/zooms with the canvas). No full-screen
 *  overlay — clicking anywhere outside closes it. Members can be dragged out of
 *  the grid and dropped onto the Canvas. */
function FinderDropdown({
  folder,
  onClose,
  onOpenPhoto,
  onDropMemberOut,
}: {
  folder: FolderModel;
  onClose: () => void;
  onOpenPhoto: (id: string) => void;
  onDropMemberOut: (folderId: string, assetId: string, clientX: number, clientY: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; src?: string; sx: number; sy: number; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ src?: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // A press that starts on an item is a potential drag-out, not a close.
      if (dragRef.current) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Defer so the double-click that opened it doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const startItemDrag = (e: React.PointerEvent, id: string, src?: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { id, src, sx: e.clientX, sy: e.clientY, moved: false };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) < 5) return;
      d.moved = true;
      setGhost({ src: d.src, x: ev.clientX, y: ev.clientY });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setGhost(null);
      if (!d || !d.moved) return;
      const panel = ref.current?.getBoundingClientRect();
      const outside =
        !panel ||
        ev.clientX < panel.left ||
        ev.clientX > panel.right ||
        ev.clientY < panel.top ||
        ev.clientY > panel.bottom;
      if (outside) {
        onDropMemberOut(folder.id, d.id, ev.clientX, ev.clientY);
        onClose();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: folder.geom.x,
        top: folder.geom.y + FOLDER_TILE_H + 8,
        width: 300,
        maxHeight: 260,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-sf)",
        border: "1px solid var(--bd)",
        borderRadius: 4,
        boxShadow: "0 14px 36px rgba(0,0,0,.55)",
        zIndex: 2000,
        overflow: "hidden",
      }}
    >
      {/* Caret pointing up to the folder */}
      <div
        style={{
          position: "absolute",
          left: 22,
          top: -6,
          width: 10,
          height: 10,
          background: "var(--bg-sf)",
          borderLeft: "1px solid var(--bd)",
          borderTop: "1px solid var(--bd)",
          transform: "rotate(45deg)",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderBottom: "1px solid var(--bd)",
          flex: "0 0 auto",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {folder.name}
        </span>
        <span style={{ fontSize: 11, color: "var(--t3)", flex: "0 0 auto" }}>
          {folder.count} {folder.count === 1 ? "item" : "items"}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ display: "flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", border: 0, borderRadius: 2, background: "transparent", color: "var(--t2)", cursor: "pointer", flex: "0 0 auto" }}
        >
          <CloseIcon width={11} height={11} strokeWidth={2} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
          gap: 12,
          alignContent: "start",
          // The canvas root sets `touch-action: none` to own pinch/pan/long-press,
          // and that also suppresses touch scrolling for everything inside it —
          // including this list. Hand the gesture back where a finger is meant
          // to scroll rather than move the canvas.
          touchAction: "pan-y",
        }}
      >
        {folder.items.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", padding: "18px 0", textAlign: "center", color: "var(--t3)", fontSize: 12 }}>
            This folder is empty.
          </div>
        ) : (
          folder.items.map((it) => (
            <button
              key={it.id}
              onPointerDown={(e) => startItemDrag(e, it.id, it.src)}
              onDoubleClick={() => onOpenPhoto(it.id)}
              title={`${it.filename} — double-click to open, or drag onto the canvas`}
              className="am-finder-item"
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: 5, border: 0, borderRadius: 4, background: "transparent", cursor: "grab", fontFamily: "inherit" }}
            >
              <span
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: 3,
                  background: it.src ? `center / cover no-repeat url(${it.src})` : "var(--bg-in)",
                }}
              />
              <span style={{ fontSize: 10.5, color: "var(--t2)", width: "100%", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {it.filename}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Drag ghost — portalled to <body> so it tracks the viewport cursor, not
          the zoomed/panned canvas that this dropdown lives inside. */}
      {ghost &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: ghost.x + 8,
              top: ghost.y + 8,
              width: 64,
              height: 64,
              borderRadius: 3,
              border: "1px solid var(--bdh)",
              boxShadow: "0 8px 22px rgba(0,0,0,.55)",
              background: ghost.src ? `center / cover no-repeat url(${ghost.src})` : "var(--bg-el)",
              pointerEvents: "none",
              opacity: 0.9,
              zIndex: 9999,
            }}
          />,
          document.body,
        )}
    </div>
  );
}
