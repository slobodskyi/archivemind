import type { ReactNode } from "react";
import {
  ChevronDownIcon,
  ShareIcon,
  UndoIcon,
  RedoIcon,
  LogsIcon,
  HelpIcon,
  PrivacyIcon,
} from "@/components/icons/icons";

interface AppHeaderProps {
  projLabel: string;
  onHome: () => void;
  onOpenProj: () => void;
  showZoomControl?: boolean;
  zoomPct?: string;
  onToggleZoomMenu?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenHelp?: () => void;
  onFlashToast?: (text: string) => void;
  onOpenAcct?: () => void;
  viewTabs?: ReactNode;
}

function UtilButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="tw"
      style={{
        display: "flex",
        width: 30,
        height: 30,
        alignItems: "center",
        justifyContent: "center",
        border: 0,
        borderRadius: 2,
        background: "transparent",
        color: "var(--t2)",
        cursor: "pointer",
      }}
    >
      {icon}
      <span className="tip">{label}</span>
    </button>
  );
}

export default function AppHeader({
  projLabel,
  onHome,
  onOpenProj,
  showZoomControl = true,
  zoomPct = "100%",
  onToggleZoomMenu,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onOpenHelp,
  onFlashToast,
  onOpenAcct,
  viewTabs,
}: AppHeaderProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 52,
        background: "var(--bg-nb)",
        borderBottom: "1px solid var(--bd)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        zIndex: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: 380, minWidth: 0 }}>
        <button
          onClick={onHome}
          aria-label="Home"
          title="Home"
          style={{
            display: "flex",
            width: 30,
            height: 30,
            alignItems: "center",
            justifyContent: "center",
            border: 0,
            borderRadius: 2,
            background: "transparent",
            color: "var(--t2)",
            cursor: "pointer",
            flex: "0 0 auto",
          }}
        >
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
        </button>
        <button
          onClick={onOpenProj}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 30,
            padding: "0 9px",
            background: "var(--bg-sf)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            color: "var(--t1)",
            fontSize: 13,
            fontWeight: 400,
            fontFamily: "inherit",
            cursor: "pointer",
            minWidth: 0,
            maxWidth: 260,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, flex: "0 0 auto" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} style={{ width: 5, height: 5, borderRadius: 1, background: "currentColor", opacity: 0.7 }} />
            ))}
          </div>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projLabel}</span>
          <ChevronDownIcon width={11} height={11} stroke="var(--t3)" style={{ flex: "0 0 auto" }} />
        </button>
      </div>

      {viewTabs}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={onUndo}
          title="Undo"
          aria-label="Undo"
          disabled={!canUndo}
          style={{
            display: "flex",
            width: 30,
            height: 30,
            alignItems: "center",
            justifyContent: "center",
            border: 0,
            borderRadius: 2,
            background: "transparent",
            color: canUndo ? "var(--t2)" : "var(--tm)",
            cursor: canUndo ? "pointer" : "default",
          }}
        >
          <UndoIcon />
        </button>
        <button
          onClick={onRedo}
          title="Redo"
          aria-label="Redo"
          disabled={!canRedo}
          style={{
            display: "flex",
            width: 30,
            height: 30,
            alignItems: "center",
            justifyContent: "center",
            border: 0,
            borderRadius: 2,
            background: "transparent",
            color: canRedo ? "var(--t2)" : "var(--tm)",
            cursor: canRedo ? "pointer" : "default",
          }}
        >
          <RedoIcon />
        </button>
        <span style={{ width: 1, height: 20, background: "var(--bd)" }} />
        {showZoomControl && (
          <button
            onClick={onToggleZoomMenu}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              height: 30,
              padding: "0 10px",
              background: "var(--bg-sf)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              color: "var(--t2)",
              fontSize: 12,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {zoomPct}
            <ChevronDownIcon width={10} height={10} stroke="currentColor" />
          </button>
        )}
        <span style={{ width: 1, height: 20, background: "var(--bd)" }} />
        <UtilButton label="Logs" icon={<LogsIcon />} onClick={() => onFlashToast?.("Activity log coming soon")} />
        <UtilButton label="Help" icon={<HelpIcon />} onClick={onOpenHelp} />
        <UtilButton label="Privacy Policy" icon={<PrivacyIcon />} onClick={() => onFlashToast?.("Privacy Policy coming soon")} />
        <span style={{ width: 1, height: 20, background: "var(--bd)" }} />
        <button
          onClick={() => onFlashToast?.("Sharing coming soon")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px",
            background: "transparent",
            border: "1px solid var(--bdh)",
            borderRadius: 2,
            color: "var(--t1)",
            fontSize: 12,
            fontWeight: 400,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          <ShareIcon />
          SHARE
        </button>
        <button
          onClick={onOpenAcct}
          aria-label="Account menu"
          style={{
            width: 30,
            height: 30,
            borderRadius: 2,
            background: "var(--bg-el)",
            border: "1px solid var(--bdh)",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "inherit",
            color: "var(--t1)",
          }}
        >
          AM
        </button>
      </div>
    </div>
  );
}
