import { memo } from "react";
import type { Tool } from "@/types";
import { FrameToolIcon, CopyIcon, TrashIcon } from "@/components/icons/icons";

interface WorkspaceActionBarProps {
  tool: Tool;
  selCount: number;
  onArtboard: () => void;
  onTidy: () => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onGroup: () => void;
  onDelete: () => void;
}

/* Inline glyphs for the actions without an existing icon (mono/line style). */
const gp = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const DuplicateGlyph = () => (<svg {...gp}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" /></svg>);
const ExportGlyph = () => (<svg {...gp}><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></svg>);
const GroupGlyph = () => (<svg {...gp}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>);
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
 *  tool (moved off the left toolbar) plus selection actions. Copy/Duplicate/
 *  Export/Group are stubs for now; Delete is real (bulk trash + undo, ADR
 *  0033 — the old Archive stub sat next to it implying a parity that never
 *  existed, so it's gone until asset archiving is a real feature). */
function WorkspaceActionBar({
  tool,
  selCount,
  onArtboard,
  onTidy,
  onCopy,
  onDuplicate,
  onExport,
  onGroup,
  onDelete,
}: WorkspaceActionBarProps) {
  const noSel = selCount === 0;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
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
      <Btn title="Artboard" active={tool === "frame"} onClick={onArtboard}>
        <FrameToolIcon />
      </Btn>
      <Btn title={selCount >= 2 ? "Tidy up selection" : "Tidy up canvas"} onClick={onTidy}>
        <TidyGlyph />
      </Btn>

      <Divider />

      <Btn title="Copy" disabled={noSel} onClick={onCopy}>
        <CopyIcon width={16} height={16} />
      </Btn>
      <Btn title="Duplicate" disabled={noSel} onClick={onDuplicate}>
        <DuplicateGlyph />
      </Btn>
      <Btn title="Export" disabled={noSel} onClick={onExport}>
        <ExportGlyph />
      </Btn>
      <Btn title="Group" disabled={noSel} onClick={onGroup}>
        <GroupGlyph />
      </Btn>

      <Divider />

      <Btn title="Delete" danger disabled={noSel} onClick={onDelete}>
        <TrashIcon width={16} height={16} />
      </Btn>
    </div>
  );
}

export default memo(WorkspaceActionBar);
