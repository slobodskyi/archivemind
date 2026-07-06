import {
  LibraryIcon,
  SparkleIcon,
  HashIcon,
  HistoryIcon,
  FrameIcon,
  SearchIcon,
  MessageIcon,
  HelpIcon,
  AddIcon,
} from "@/components/icons/icons";
import type { Tool } from "@/types";

interface RailItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}

interface IconRailProps {
  tool: Tool;
  onToolSelect: () => void;
  onOpenSearch: () => void;
  onRailAdd: () => void;
}

export default function IconRail({ tool, onToolSelect, onOpenSearch, onRailAdd }: IconRailProps) {
  // Only "Select" reflects active state — matches the source exactly: Search/Chat/etc.
  // never highlight even when their panel is open.
  const items: RailItem[] = [
    { key: "folder", label: "Library", icon: <LibraryIcon /> },
    { key: "sparkles", label: "AI Agents", icon: <SparkleIcon width={20} height={20} strokeWidth={1.6} /> },
    { key: "hash", label: "Tags", icon: <HashIcon /> },
    { key: "history", label: "History", icon: <HistoryIcon /> },
    { key: "frame", label: "Select", icon: <FrameIcon />, onClick: onToolSelect, active: tool === "select" },
    { key: "search", label: "Search", icon: <SearchIcon width={20} height={20} strokeWidth={1.6} />, onClick: onOpenSearch },
    { key: "message", label: "Chat", icon: <MessageIcon /> },
    { key: "help", label: "Help", icon: <HelpIcon width={20} height={20} strokeWidth={1.6} /> },
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: 60,
        background: "var(--bg-sidebar)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 0",
        zIndex: 40,
      }}
    >
      <button
        onClick={onRailAdd}
        className="am-rail-item"
        aria-label="Add / Import"
        style={{
          display: "flex",
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
          border: 0,
          borderRadius: 999,
          cursor: "pointer",
          marginBottom: 18,
        }}
      >
        <AddIcon width={22} height={22} stroke="#000" strokeWidth={1.8} />
        <span className="am-tip">Add / Import</span>
      </button>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
        {items.map((r) => (
          <button
            key={r.key}
            onClick={r.onClick}
            className="am-rail-item"
            aria-label={r.label}
            style={{
              display: "flex",
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              background: r.active ? "var(--bg-elevated)" : "transparent",
              border: 0,
              borderRadius: 9,
              color: r.active ? "#fff" : "var(--text-tertiary)",
              cursor: "pointer",
            }}
          >
            {r.icon}
            <span className="am-tip">{r.label}</span>
          </button>
        ))}
      </div>

      <div
        style={{
          position: "relative",
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "linear-gradient(135deg,#5b6af0,#7c5cff)",
          cursor: "pointer",
        }}
      />
    </div>
  );
}
