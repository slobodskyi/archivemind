import { memo } from "react";
import type { ViewMode } from "@/types";
import { ViewTimelineIcon, ViewMapIcon, ViewSenseIcon } from "@/components/icons/icons";

interface ViewSwitcherProps {
  show: boolean;
  view: ViewMode;
  onSelect: (v: ViewMode) => void;
}

/** Canvas is the primary browse grid; the others re-sort the same files. */
const SORTS: { key: ViewMode; label: string; Icon: typeof ViewTimelineIcon }[] = [
  { key: "timeline", label: "TIMELINE", Icon: ViewTimelineIcon },
  { key: "sense", label: "TOPIC", Icon: ViewSenseIcon },
  // The geographic map goes last.
  { key: "map", label: "MAP", Icon: ViewMapIcon },
];

/** The bottom segmented control that replaced the header view tabs. It states the
 *  hierarchy the header couldn't: the **workspace** (Canvas) is the main space you
 *  work in, and Timeline / Topic / Map are a *separate* section for organizing,
 *  searching and selecting the files you then bring back to the workspace. Canvas
 *  is the primary segment; a divider sets the three sorts apart as their own group. */
function ViewSwitcher({ show, view, onSelect }: ViewSwitcherProps) {
  if (!show) return null;

  const seg = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 5,
    height: 28,
    padding: "0 12px",
    border: 0,
    borderRadius: 2,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    fontFamily: "inherit",
    cursor: "pointer",
    background: active ? "var(--bg-el)" : "transparent",
    color: active ? "var(--t1)" : "var(--t2b)",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: 3,
        background: "rgba(20,20,20,.92)",
        border: "1px solid var(--bd)",
        borderRadius: 3,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        zIndex: 35,
      }}
    >
      {/* Canvas is the primary browse grid; the rest re-sort the same files.
          (The working "workspaces" live in the header browser — Stage 2.) */}
      <button onClick={() => onSelect("neural")} style={seg(view === "neural")} title="Canvas — the file grid">
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x={3} y={3} width={8} height={8} rx={1} />
          <rect x={13} y={3} width={8} height={8} rx={1} />
          <rect x={3} y={13} width={8} height={8} rx={1} />
          <rect x={13} y={13} width={8} height={8} rx={1} />
        </svg>
        <span>CANVAS</span>
      </button>

      {SORTS.map(({ key, label, Icon }) => (
        <button key={key} onClick={() => onSelect(key)} style={seg(view === key)} title={`Organize by ${label.toLowerCase()}`}>
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export default memo(ViewSwitcher);
