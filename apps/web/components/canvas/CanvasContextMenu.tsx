import { Fragment, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { AssetLabel, LabelNames } from "@archivemind/shared";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
import { AddIcon, CheckIcon, ChevronRightIcon } from "@/components/icons/icons";
import { LABEL_COLORS } from "@/lib/labels";
import { Z } from "@/lib/ui";

/** One row of the "Add to workspace" submenu. */
export interface ContextMenuBoard {
  id: string;
  name: string;
  color: AssetLabel;
  count: number;
  /** Every file the menu targets is already in it — shown ticked and inert. */
  hasAll: boolean;
}

const MENU_W = 190;
const SUB_W = 210;
const ITEM_H = 33;

/** The panel look, shared by the menu and its flyout so the two read as one. */
const panelSurface = {
  background: "rgba(18,18,18,.97)",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  backdropFilter: "blur(20px)",
  boxShadow: "0 20px 60px rgba(0,0,0,.7)",
  padding: 6,
} as const;

const itemStyle = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "8px 10px",
  border: 0,
  borderRadius: 2,
  cursor: "pointer",
  fontFamily: "inherit",
  color: "var(--t2)",
  fontSize: 12.5,
  background: "transparent",
  textAlign: "left",
} as const;

interface CanvasContextMenuProps {
  menu: { x: number; y: number; targetId: string | null } | null;
  /** Hide project-editing tools that don't apply to the read-only all-files
   *  grid — matches the left toolbar's own gating. */
  allFilesMode: boolean;
  /** Current selection size — with a selection, "Move to Trash" acts on it;
   *  without one it acts on the right-clicked tile (menu.targetId). */
  selCount: number;
  onClose: () => void;
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
  /** The open project's workspaces (ADR 0044), or undefined where there are
   *  none to offer (the all-files grid). Until this, the only ways to put a
   *  file into a workspace were a drag onto its chip and the left toolbar's ＋,
   *  and neither says "workspace" until you are already using one. */
  boards?: ContextMenuBoard[];
  onAddToBoard: (id: string) => void;
  /** A new workspace holding the targeted files — and opened. */
  onCreateBoardWithTargets: () => void;
}

/** Right-click / double-click menu on the grid. Curation and arrangement only —
 *  the tool switches, search and AI/add actions live on the toolbars, so they
 *  were removed here. Available on the Workspace and the sorting views.
 *
 *  Ordered by how often each answer is wanted: the colour, then where the files
 *  go (a workspace, a group, a folder, a download), then layer order — four
 *  items that used to sit straight under the swatches though they are the
 *  least-used thing here — then Trash and Fit. */
export default function CanvasContextMenu({
  menu,
  allFilesMode,
  selCount,
  onClose,
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
  boards,
  onAddToBoard,
  onCreateBoardWithTargets,
}: CanvasContextMenuProps) {
  /** The open submenu, tied to the menu instance it was opened in — a stale
   *  `true` must not reopen the flyout on the next right-click. `flip` sends it
   *  left when there is no room on the right; `dy` lifts it off the bottom edge. */
  const [sub, setSub] = useState<{ menu: object; flip: boolean; dy: number } | null>(null);
  if (!menu) return null;
  const deletable = !allFilesMode && (selCount > 0 || menu.targetId != null);
  // Labels are curation, not project editing — they work on the read-only
  // all-files grid too, which is where an untriaged pile usually is.
  const labelable = selCount > 0 || menu.targetId != null;
  const canGroup = !allFilesMode && (hasGroup || selCount >= 2);
  // Layer order applies to the selection, or the single right-clicked tile.
  const canLayer = !allFilesMode && (selCount > 0 || menu.targetId != null);
  // One file is enough — unlike Group, a workspace of one is a real thing.
  const canAddToBoard = !allFilesMode && boards !== undefined && (selCount > 0 || menu.targetId != null);
  const subOpen = sub?.menu === menu;

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const openSub = (el: HTMLElement) => {
    if (subOpen) return;
    const r = el.getBoundingClientRect();
    const h = 14 + ((boards?.length ?? 0) + 1) * ITEM_H + 11;
    setSub({
      menu,
      flip: r.right + 7 + SUB_W + 8 > window.innerWidth,
      // Up by as much as it would overrun the bottom, never above the top.
      dy: Math.max(-(r.top - 15), Math.min(0, window.innerHeight - 8 - (r.top - 7 + h))),
    });
  };

  // Hovering any OTHER row closes the flyout. One listener on the menu body
  // rather than a prop on every item; the submenu row and its flyout share a
  // `data-submenu` wrapper, so moving onto the flyout keeps it open.
  const closeSubOnHover = (e: ReactPointerEvent) => {
    if (subOpen && !(e.target as HTMLElement).closest("[data-submenu]")) setSub(null);
  };

  // Built as a list so exactly one divider falls between the groups that are
  // actually present — no leading, trailing or doubled dividers to hand-tune as
  // items come and go.
  const sections: ReactNode[] = [];
  if (labelable) {
    sections.push(
      <LabelSwatchRow
        names={labelNames}
        current={currentLabel}
        onPick={(label) => {
          onClose();
          onPickLabel(label);
        }}
      />,
    );
  }
  if (canAddToBoard || canGroup) {
    sections.push(
      <>
        {canAddToBoard && (
          <div data-submenu="" style={{ position: "relative" }}>
            <button
              aria-haspopup="menu"
              aria-expanded={subOpen}
              // Hover opens it for a mouse; a tap opens it on touch. Click only
              // ever OPENS: with a mouse, hover already did, and a toggle here
              // would shut it again on the click that follows.
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") openSub(e.currentTarget);
              }}
              onClick={(e) => openSub(e.currentTarget)}
              style={{
                ...itemStyle,
                justifyContent: "space-between",
                background: subOpen ? "rgba(255,255,255,.05)" : "transparent",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selCount > 1 ? `Add ${selCount} to workspace` : "Add to workspace"}
              </span>
              <ChevronRightIcon width={10} height={10} stroke="currentColor" />
            </button>
            {subOpen && sub && (
              <div
                role="menu"
                style={{
                  ...panelSurface,
                  position: "absolute",
                  top: -7 + sub.dy,
                  // Flush with the panel's outer edge: 6px padding + 1px border.
                  ...(sub.flip ? { right: "calc(100% + 7px)" } : { left: "calc(100% + 7px)" }),
                  width: SUB_W,
                  maxHeight: "calc(100dvh - 16px)",
                  overflowY: "auto",
                }}
              >
                {(boards ?? []).map((b) => (
                  <button
                    key={b.id}
                    role="menuitem"
                    disabled={b.hasAll}
                    onClick={run(() => onAddToBoard(b.id))}
                    title={b.hasAll ? `Already in ${b.name}` : `Add to ${b.name}`}
                    style={{ ...itemStyle, gap: 9, cursor: b.hasAll ? "default" : "pointer" }}
                  >
                    <span aria-hidden="true" style={{ flex: "0 0 auto", width: 8, height: 8, borderRadius: "50%", background: LABEL_COLORS[b.color] }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: b.hasAll ? "var(--t3)" : "var(--t1)" }}>
                      {b.name}
                    </span>
                    {b.hasAll ? (
                      <CheckIcon width={10} height={10} stroke="var(--t3)" />
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--t3)" }}>[{b.count}]</span>
                    )}
                  </button>
                ))}
                {(boards ?? []).length > 0 && <MenuDivider />}
                <button
                  role="menuitem"
                  onClick={run(onCreateBoardWithTargets)}
                  style={{ ...itemStyle, gap: 8, color: "var(--ac)" }}
                >
                  <AddIcon width={12} height={12} />
                  New workspace
                </button>
              </div>
            )}
          </div>
        )}
        {canGroup && (
          <>
            {hasGroup ? (
              <MenuItem label="Ungroup" onClick={run(onUngroup)} />
            ) : (
              <MenuItem label={`Group ${selCount}`} onClick={run(onGroup)} />
            )}
            <MenuItem label="Put in folder" onClick={run(onFolder)} />
            <MenuItem label={selCount > 1 ? `Download ${selCount}` : "Download"} onClick={run(onExport)} />
          </>
        )}
      </>,
    );
  }
  if (canLayer) {
    sections.push(
      <>
        <MenuItem label="Bring to front" onClick={run(onBringToFront)} />
        <MenuItem label="Bring forward" onClick={run(onBringForward)} />
        <MenuItem label="Send backward" onClick={run(onSendBackward)} />
        <MenuItem label="Send to back" onClick={run(onSendToBack)} />
      </>,
    );
  }
  if (deletable) {
    sections.push(
      <MenuItem
        label={selCount > 1 ? `Move ${selCount} to Trash` : "Move to Trash"}
        danger
        onClick={run(onDelete)}
      />,
    );
  }
  sections.push(<MenuItem label="Fit to view" onClick={run(onFit)} />);

  return (
    <MenuPanel x={menu.x} y={menu.y} height={400} onClose={onClose}>
      <div onPointerOver={closeSubOnHover}>
        {sections.map((section, i) => (
          <Fragment key={i}>
            {i > 0 && <MenuDivider />}
            {section}
          </Fragment>
        ))}
      </div>
    </MenuPanel>
  );
}

/** The shell every canvas menu shares: a full-screen backdrop that closes on any
 *  click (a second right-click included, so two menus can never be open at
 *  once), and the panel itself clamped inside the viewport. Exported because the
 *  folder menu must BE this object rather than resemble it. */
export function MenuPanel({
  x,
  y,
  width = MENU_W,
  /** Reserved height used only to clamp the panel above the viewport's bottom
   *  edge — an estimate, not a fixed size. */
  height = 320,
  onClose,
  children,
}: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const left = typeof window !== "undefined" ? Math.min(x, window.innerWidth - width - 8) : x;
  const top = typeof window !== "undefined" ? Math.min(y, window.innerHeight - height) : y;
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
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          ...panelSurface,
          position: "fixed",
          left,
          top,
          width,
          zIndex: Z.menu,
        }}
      >
        {children}
      </div>
    </>
  );
}

export function MenuDivider() {
  return <div style={{ height: 1, background: "var(--bd)", margin: "5px 4px" }} />;
}

export function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ ...itemStyle, color: danger ? "var(--red)" : "var(--t2)" }}
   >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}
