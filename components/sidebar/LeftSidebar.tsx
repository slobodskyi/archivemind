import type { ReactNode } from "react";
import {
  SidebarToggleIcon,
  SearchIcon,
  ChatIcon,
  ExifIcon,
  TagIcon,
  LogsIcon,
  HelpIcon,
  PrivacyIcon,
} from "@/components/icons/icons";

interface SidebarTool {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
}

interface LeftSidebarProps {
  expanded: boolean;
  onToggle: () => void;
  chatOpen?: boolean;
  searchOpen?: boolean;
  onOpenSearch?: () => void;
  onToggleChat?: () => void;
  onOpenHelp?: () => void;
}

export default function LeftSidebar({
  expanded,
  onToggle,
  chatOpen = false,
  searchOpen = false,
  onOpenSearch,
  onToggleChat,
  onOpenHelp,
}: LeftSidebarProps) {
  const sidebarW = expanded ? 220 : 52;
  const labelOp = expanded ? 1 : 0;
  const labelMax = expanded ? "140px" : "0px";

  const sbTools: SidebarTool[] = [
    { key: "search", label: "Smart Search", icon: <SearchIcon />, active: searchOpen, onClick: onOpenSearch },
    { key: "chat", label: "AI Chat", icon: <ChatIcon />, active: chatOpen, onClick: onToggleChat },
    { key: "exif", label: "Extract EXIF", icon: <ExifIcon /> },
    { key: "tag", label: "Auto-Tag", icon: <TagIcon /> },
  ];

  const sbBottom: SidebarTool[] = [
    { key: "logs", label: "Logs", icon: <LogsIcon /> },
    { key: "help", label: "Help", icon: <HelpIcon />, onClick: onOpenHelp },
    { key: "privacy", label: "Privacy Policy", icon: <PrivacyIcon /> },
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        left: 0,
        bottom: 0,
        width: sidebarW,
        background: "var(--bg-s)",
        borderRight: "1px solid var(--bd)",
        display: "flex",
        flexDirection: "column",
        zIndex: 38,
        transition: "width .22s cubic-bezier(.22,1,.36,1)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "8px auto 4px",
          width: 32,
          height: 32,
          border: 0,
          borderRadius: 2,
          background: "transparent",
          color: "var(--t2b)",
          cursor: "pointer",
        }}
      >
        <SidebarToggleIcon expanded={expanded} />
      </button>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, padding: "0 8px", overflow: "hidden" }}>
        {sbTools.map((t) => (
          <button
            key={t.key}
            onClick={t.onClick}
            aria-label={t.label}
            className="tw"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              width: "100%",
              height: 38,
              padding: "0 9px",
              border: 0,
              borderRadius: 2,
              background: t.active ? "color-mix(in srgb,var(--ac) 12%,transparent)" : "transparent",
              color: t.active ? "var(--ac)" : "var(--t2b)",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              flex: "0 0 auto",
              transition: "background .15s",
            }}
          >
            <span style={{ display: "flex", flex: "0 0 16px" }}>{t.icon}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: "0.02em",
                overflow: "hidden",
                maxWidth: labelMax,
                opacity: labelOp,
                transition: "opacity .15s,max-width .2s",
              }}
            >
              {t.label}
            </span>
            <span className="tip">{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--bd)", padding: "6px 8px 10px", display: "flex", flexDirection: "column", gap: 1 }}>
        {sbBottom.map((b) => (
          <button
            key={b.key}
            onClick={b.onClick}
            aria-label={b.label}
            className="tw"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              width: "100%",
              height: 32,
              padding: "0 9px",
              border: 0,
              borderRadius: 2,
              background: "transparent",
              color: "var(--t2b)",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              flex: "0 0 auto",
            }}
          >
            <span style={{ display: "flex", flex: "0 0 16px" }}>{b.icon}</span>
            <span
              style={{
                fontSize: 10.5,
                letterSpacing: "0.02em",
                overflow: "hidden",
                maxWidth: labelMax,
                opacity: labelOp,
                transition: "opacity .15s,max-width .2s",
              }}
            >
              {b.label}
            </span>
            <span className="tip">{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
