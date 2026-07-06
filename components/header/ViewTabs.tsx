import type { ViewMode } from "@/types";
import { ViewCanvasIcon, ViewTimelineIcon, ViewMapIcon, ViewSmartIcon } from "@/components/icons/icons";

interface ViewTabsProps {
  view: ViewMode;
  onSelect: (v: ViewMode) => void;
}

const TABS: { key: ViewMode; label: string; Icon: typeof ViewCanvasIcon }[] = [
  { key: "canvas", label: "Canvas", Icon: ViewCanvasIcon },
  { key: "timeline", label: "Timeline", Icon: ViewTimelineIcon },
  { key: "map", label: "Map", Icon: ViewMapIcon },
  { key: "smart", label: "Smart", Icon: ViewSmartIcon },
];

export default function ViewTabs({ view, onSelect }: ViewTabsProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
        display: "flex",
        gap: 2,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 999,
        padding: 3,
        zIndex: 2,
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
              gap: 6,
              height: 28,
              padding: "0 12px",
              border: 0,
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              background: active ? "var(--bg-elevated)" : "transparent",
              color: active ? "#fff" : "var(--text-tertiary)",
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
