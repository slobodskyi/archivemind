import type { ViewMode } from "@/types";
import { ViewTimelineIcon, ViewMapIcon, ViewSenseIcon } from "@/components/icons/icons";

interface ViewTabsProps {
  show: boolean;
  view: ViewMode;
  onSelect: (v: ViewMode) => void;
}

// The sorting views only — Workspace (neural) is promoted to its own distinct
// subheader control (WorkspaceToggle), so it no longer reads as a peer tab.
const TABS: { key: ViewMode; label: string; Icon: typeof ViewTimelineIcon }[] = [
  { key: "timeline", label: "TIMELINE", Icon: ViewTimelineIcon },
  { key: "map", label: "MAP", Icon: ViewMapIcon },
  { key: "sense", label: "TOPIC", Icon: ViewSenseIcon },
];

export default function ViewTabs({ show, view, onSelect }: ViewTabsProps) {
  if (!show) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
        display: "flex",
        gap: 1,
        background: "transparent",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        padding: 2,
      }}
    >
      {TABS.map(({ key, label, Icon }) => {
        const active = view === key;
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              height: 28,
              padding: "0 13px",
              border: 0,
              borderRadius: 2,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              fontFamily: "inherit",
              cursor: "pointer",
              background: active ? "var(--bg-el)" : "transparent",
              // Inactive tabs use --t2b (4.72:1); --t3 (2.96:1) fails WCAG.
              color: active ? "var(--t1)" : "var(--t2b)",
            }}
          >
            <Icon />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
