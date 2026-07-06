import type { ReactNode } from "react";
import { ChevronDownIcon, ShareIcon, SparkleIcon } from "@/components/icons/icons";

interface AppHeaderProps {
  zoomPct?: string;
  onZoomReset?: () => void;
  onAnalyze?: () => void;
  viewTabs?: ReactNode;
}

export default function AppHeader({ zoomPct = "100%", onZoomReset, onAnalyze, viewTabs }: AppHeaderProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        background: "var(--bg-navbar)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 18px 0 78px",
        zIndex: 30,
      }}
    >
      {viewTabs}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, width: 18, height: 18 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: 1, background: "var(--text-secondary)" }} />
          ))}
        </div>
        <ChevronDownIcon width={14} height={14} stroke="var(--text-muted)" strokeWidth={1.6} />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Kyiv 2026 — Frontline</span>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Documentary archive</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={onZoomReset}
          aria-label="Reset zoom to fit"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            height: 32,
            padding: "0 11px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 999,
            color: "var(--text-secondary)",
            fontSize: 12,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {zoomPct}
          <ChevronDownIcon width={12} height={12} stroke="currentColor" strokeWidth={1.6} />
        </button>
        <button
          onClick={onAnalyze}
          aria-label="Analyze selection"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 14px",
            background: "var(--accent-green)",
            border: 0,
            borderRadius: 999,
            color: "#ffffff",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          <SparkleIcon width={15} height={15} strokeWidth={1.8} />
          Analyze
        </button>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 13px",
            background: "transparent",
            border: "1px solid var(--border-hover)",
            borderRadius: 999,
            color: "var(--text-primary)",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          <ShareIcon width={14} height={14} />
          Share
        </button>
      </div>
    </div>
  );
}
