import { memo } from "react";
import type { AssetLabel, LabelNames } from "@archivemind/shared";
import type { LabelFilter } from "@/lib/labels";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
import { StickyNoteIcon, MagicWandIcon, CopyIcon, TrashIcon, FolderIcon, LabelsIcon } from "@/components/icons/icons";

interface WorkspaceActionBarProps {
  selCount: number;
  /** The AI panel is open for this selection — keeps the ✨ button lit. */
  aiOpen: boolean;
  /** Drop a new sticky note on the board canvas. */
  onAddStickyNote: () => void;
  onTidy: () => void;
  /** Opens the AI panel over the selection (analyze / captions). */
  onAi: () => void;
  onCopy: () => void;
  onExport: () => void;
  /** Bind the selection into a move-/edit-together group (no folder — ADR 0034 folders live on the Folder button). */
  onGroup: () => void;
  /** Wrap the selection in a real folder (collapsible tile + Finder popup). */
  onFolder: () => void;
  onDelete: () => void;
  /** Colour-label control — the swatch row opens above the bar. It is
   *  context-sensitive (ADR 0040 amended): with a selection it LABELS the
   *  selection; with nothing selected it FILTERS the canvas to one colour. */
  labelNames: LabelNames;
  labelMenuOpen: boolean;
  selectionLabel: AssetLabel | "mixed" | null;
  labelFilter: LabelFilter;
  onToggleLabelMenu: () => void;
  onPickLabel: (label: AssetLabel | null) => void;
  onSetFilter: (filter: LabelFilter) => void;
}

/* Inline glyphs for the actions without an existing icon (mono/line style). */
const gp = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ExportGlyph = () => (<svg {...gp}><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></svg>);
/* Group: two overlapping tiles bound by a corner-bracket frame — a set that
   moves and edits as one, not a container. */
const GroupGlyph = () => (<svg {...gp}><path d="M3 8V4a1 1 0 0 1 1-1h4" /><path d="M21 8V4a1 1 0 0 0-1-1h-4" /><path d="M3 16v4a1 1 0 0 0 1 1h4" /><path d="M21 16v4a1 1 0 0 1-1 1h-4" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" /></svg>);
/* Tidy up: four photo-tile-shaped cells snapping into an even grid. */
const TidyGlyph = () => (<svg {...gp}><rect x="3" y="4" width="8" height="6" rx="1" /><rect x="13" y="4" width="8" height="6" rx="1" /><rect x="3" y="14" width="8" height="6" rx="1" /><rect x="13" y="14" width="8" height="6" rx="1" /></svg>);

function Btn({
  title,
  active,
  disabled,
  danger,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const color = active ? "var(--ac)" : danger ? "var(--red)" : "var(--t2)";
  return (
    <button
      onClick={onClick}
      className="am-tb tw-top"
      title={title}
      aria-label={title}
      style={{
        display: "flex",
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        border: 0,
        borderRadius: 2,
        cursor: "pointer",
        background: active ? "color-mix(in srgb,var(--ac) 12%,transparent)" : "transparent",
        color,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
      <span className="tip">{title}</span>
    </button>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 3px" }} />;
}

/** Bottom action bar for the Workspace (neural view) only. Hosts the artboard
 *  tool (moved off the left toolbar) plus selection actions. Copy/Export are
 *  stubs for now; Group binds the selection into a move-/edit-together set (no
 *  container) and Folder wraps it in a real folder (ADR 0034) — the two used to
 *  be one button. Delete is real (bulk trash + undo, ADR 0033 — the old Archive
 *  stub sat next to it implying a parity that never existed, so it's gone until
 *  asset archiving is a real feature), and so is the AI button. (Duplicate was
 *  removed — Copy already covers it.) */
function WorkspaceActionBar({
  selCount,
  aiOpen,
  onAddStickyNote,
  onTidy,
  onAi,
  onCopy,
  onExport,
  onGroup,
  onFolder,
  onDelete,
  labelNames,
  labelMenuOpen,
  selectionLabel,
  labelFilter,
  onToggleLabelMenu,
  onPickLabel,
  onSetFilter,
}: WorkspaceActionBarProps) {
  const noSel = selCount === 0;
  // The "none" filter (files with no colour) has no swatch — map it to the
  // cleared ring; picking a colour or the ✕ drives the filter directly.
  const filterCurrent: AssetLabel | "mixed" | null = labelFilter === "none" ? null : labelFilter;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        // Sits ABOVE the bottom view switcher (which owns bottom:20 centre).
        bottom: 66,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 8px",
        background: "rgba(20,20,20,.92)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        zIndex: 35,
      }}
    >
      <Btn title="Sticky note" onClick={onAddStickyNote}>
        <StickyNoteIcon width={16} height={16} />
      </Btn>
      <Btn title={selCount >= 2 ? "Tidy up selection" : "Tidy up canvas"} onClick={onTidy}>
        <TidyGlyph />
      </Btn>

      <Divider />

      {/* The selection's AI entry point. Bulk AI used to be reachable only from
          the left toolbar and the right-click menu — neither of which is where
          the eye goes after selecting tiles, so the most common bulk action was
          the hardest one to find. */}
      <Btn title={selCount >= 2 ? `Analyze ${selCount} with AI` : "Analyze with AI"} active={aiOpen} disabled={noSel} onClick={onAi}>
        <MagicWandIcon width={16} height={16} />
      </Btn>

      <Divider />

      {/* The swatch row pops ABOVE the bar rather than replacing its buttons —
          labelling is usually a run of many, and a picker that closed the bar
          would cost a re-open per photo. With no selection the same row filters
          the canvas by colour instead. */}
      {labelMenuOpen && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "100%",
            marginBottom: 8,
            transform: "translateX(-50%)",
            padding: "4px 6px",
            background: "rgba(20,20,20,.96)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            backdropFilter: "blur(16px)",
            boxShadow: "0 8px 32px rgba(0,0,0,.45)",
          }}
        >
          <LabelSwatchRow
            names={labelNames}
            current={noSel ? filterCurrent : selectionLabel}
            onPick={noSel ? onSetFilter : onPickLabel}
            size={18}
          />
        </div>
      )}
      <Btn
        title={
          noSel
            ? labelFilter !== null
              ? "Filter by colour — on"
              : "Filter by colour"
            : selCount >= 2
              ? `Label ${selCount} (keys 1–7)`
              : "Label (keys 1–7)"
        }
        active={labelMenuOpen || (noSel && labelFilter !== null)}
        onClick={onToggleLabelMenu}
      >
        <LabelsIcon width={16} height={16} />
      </Btn>

      <Btn title="Copy" disabled={noSel} onClick={onCopy}>
        <CopyIcon width={16} height={16} />
      </Btn>
      <Btn title={selCount >= 2 ? `Group ${selCount} (move & edit together)` : "Group"} disabled={noSel} onClick={onGroup}>
        <GroupGlyph />
      </Btn>
      <Btn title="Put in folder" disabled={noSel} onClick={onFolder}>
        <FolderIcon width={16} height={16} />
      </Btn>

      <Divider />

      {/* Export sits with Delete in the closing section — the two "send it out /
          take it away" actions, at the end of the bar. */}
      <Btn title="Export" disabled={noSel} onClick={onExport}>
        <ExportGlyph />
      </Btn>
      <Btn title="Delete" danger disabled={noSel} onClick={onDelete}>
        <TrashIcon width={16} height={16} />
      </Btn>
    </div>
  );
}

export default memo(WorkspaceActionBar);
