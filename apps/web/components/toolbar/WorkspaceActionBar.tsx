import { memo } from "react";
import type { AssetLabel, LabelNames } from "@archivemind/shared";
import type { LabelFilter } from "@/lib/labels";
import LabelBarControl from "@/components/labels/LabelBarControl";
import { StickyNoteIcon, TrashIcon, FolderIcon } from "@/components/icons/icons";

interface WorkspaceActionBarProps {
  selCount: number;
  /** The AI panel is open for this selection — keeps the ✨ button lit. */
  aiOpen: boolean;
  /** Drop a new sticky note on the canvas — moved off the left rail, which is
   *  now identical in every view. */
  onAddStickyNote: () => void;
  onTidy: () => void;
  /** Opens the AI panel over the selection (analyze / captions). */
  onAi: () => void;
  /** Bind the selection into a move-/edit-together group (no folder — ADR 0034 folders live on the Folder button). */
  onGroup: () => void;
  /** Wrap the selection in a real folder (collapsible tile + Finder popup). */
  onFolder: () => void;
  /** Detach the selection from this Workspace without touching the files. */
  onRemoveFromWorkspace: () => void;
  onDelete: () => void;
  /** Colour-label control — the swatch row opens above the bar. Context
   *  sensitive (ADR 0040 amended): it marks the selection, or filters the canvas
   *  by colour when there is no selection to mark. */
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
const RemoveFromWorkspaceGlyph = () => (<svg {...gp}><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M8 12h8" /></svg>);
/* Group: two overlapping tiles bound by a corner-bracket frame — a set that
   moves and edits as one, not a container. */
const GroupGlyph = () => (<svg {...gp}><path d="M3 8V4a1 1 0 0 1 1-1h4" /><path d="M21 8V4a1 1 0 0 0-1-1h-4" /><path d="M3 16v4a1 1 0 0 0 1 1h4" /><path d="M21 16v4a1 1 0 0 1-1 1h-4" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" /></svg>);
/* Analyze with AI: a magic wand throwing sparkles (lucide wand-sparkles) — the
   universal "let the AI work on these" glyph, and unlike a bare sparkle it
   won't read as decoration or collide with Search's magnifier. */
const AnalyzeGlyph = () => (<svg {...gp}><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" /><path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" /></svg>);
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
  // Hidden below 760px: once the bar wraps, a rule that groups buttons on one
  // row only creates ragged breaks on the next — it cost the bar two extra rows.
  return <span className="am-bar-div" style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 3px" }} />;
}

/** Bottom action bar for the Workspace (neural view) only. Group binds the
 *  selection into a move-/edit-together set (no container) and Folder wraps it in
 *  a real folder (ADR 0034) — the two used to be one button. Delete is real (bulk
 *  trash + undo, ADR 0033 — the old Archive stub sat next to it implying a parity
 *  that never existed, so it's gone until asset archiving is a real feature), and
 *  so is the AI button. (Duplicate went first, because Copy covered it; Copy
 *  itself then left this bar — it is a cross-archive link, not a canvas edit like
 *  everything else here, and it stays on ⌘C/⌘V where a copy is looked for.) */
function WorkspaceActionBar({
  selCount,
  aiOpen,
  onAddStickyNote,
  onTidy,
  onAi,
  onGroup,
  onFolder,
  onRemoveFromWorkspace,
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
  return (
    <div
      // Below 760px the bar spans the width and wraps to a second row. Its
      // targets at the 44px touch minimum are wider than a phone, and centred
      // that put both ends off screen.
      className="am-bar am-bar-low"
      style={{
        position: "absolute",
        left: "50%",
        // 20, not the 66 this sat at for a year: 66 was reserved for the
        // ViewSwitcher underneath, and the two can never be on screen at once.
        // This bar needs `activeBoardId !== null` and the switcher renders only
        // when it is null, so the gap was always empty — invisible on a desktop
        // canvas, and an obvious floating slab once the bar wrapped to two rows
        // on a phone.
        bottom: 20,
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
        <StickyNoteIcon />
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
        <AnalyzeGlyph />
      </Btn>

      <Divider />

      {/* The row pops ABOVE the bar rather than replacing its buttons —
          labelling is usually a run of many, and a picker that closed the bar
          would cost a re-open per photo. */}
      <LabelBarControl
        names={labelNames}
        open={labelMenuOpen}
        onToggle={onToggleLabelMenu}
        selCount={selCount}
        selectionLabel={selectionLabel}
        filter={labelFilter}
        onPickLabel={onPickLabel}
        onSetFilter={onSetFilter}
      />

      <Btn title={selCount >= 2 ? `Group ${selCount} (move & edit together)` : "Group"} disabled={noSel} onClick={onGroup}>
        <GroupGlyph />
      </Btn>
      <Btn title="Put in folder" disabled={noSel} onClick={onFolder}>
        <FolderIcon width={16} height={16} />
      </Btn>
      <Btn title="Remove from this workspace" disabled={noSel} onClick={onRemoveFromWorkspace}>
        <RemoveFromWorkspaceGlyph />
      </Btn>

      <Divider />

      {/* Download lived here too, but it duplicated the Workspace's own delivery
          action — the same export, two buttons — so it was removed. That action
          is now a section inside the Create hub (WorkspaceOutputActions opens
          it); the right-click menu still carries `Download N` for a selection,
          which is the fast path this bar would have been. Delete stays: it is
          the one way to send the selection out of the archive from this bar. */}
      <Btn title="Delete" danger disabled={noSel} onClick={onDelete}>
        <TrashIcon width={16} height={16} />
      </Btn>
    </div>
  );
}

export default memo(WorkspaceActionBar);
