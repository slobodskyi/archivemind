import type { ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ShareIcon,
  UndoIcon,
  RedoIcon,
} from "@/components/icons/icons";

interface AppHeaderProps {
  projLabel: string;
  onHome: () => void;
  onOpenProj: () => void;
  /** Inside a project, the project name IS "all files": clicking it leaves any
   *  open Workspace and shows the whole project (ADR 0044 amended). Omitted on
   *  the workspace-wide `all` canvas, where there is no narrower scope to leave
   *  and the control stays a plain project switcher. */
  onProjectScope?: () => void;
  /** True when no Workspace is open — the name reads as the selected scope, the
   *  way the chip it replaced did. */
  projectScopeActive?: boolean;
  showZoomControl?: boolean;
  zoomPct?: string;
  onToggleZoomMenu?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onFlashToast?: (text: string) => void;
  onOpenAcct?: () => void;
  /** Real account initials/name for the avatar (replaces the old hardcoded "AM"). */
  accountInitials?: string;
  accountName?: string;
  /** Rendered in the breadcrumb, right of the project name. */
  afterProject?: ReactNode;
  /** Workspace-level outcome actions (Drafts / Download / Create). They live
   *  before the global canvas tools so their scope is visually unambiguous. */
  workspaceActions?: ReactNode;
}

export default function AppHeader({
  projLabel,
  onHome,
  onOpenProj,
  onProjectScope,
  projectScopeActive = false,
  showZoomControl = true,
  zoomPct = "100%",
  onToggleZoomMenu,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onFlashToast,
  onOpenAcct,
  accountInitials = "",
  accountName,
  afterProject,
  workspaceActions,
}: AppHeaderProps) {
  return (
    <div
      style={{
        // `fixed`, not `absolute`: absolute resolves against the 100dvh workspace
        // root, which the mobile keyboard resizes out from under the bar when a
        // sticky-note textarea is focused. Fixed anchors to the viewport top on
        // every device regardless of that. The safe-area inset keeps the 52px row
        // clear of a notch — `--hdr` carries the same total to everything that
        // sits beneath the header.
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "var(--hdr)",
        background: "var(--bg-nb)",
        borderBottom: "1px solid var(--bd)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "env(safe-area-inset-top, 0px) 14px 0",
        zIndex: 40,
      }}
    >
      {/* Takes whatever the right-hand tools leave, instead of a fixed cap. It
          used to stop at 520px, which on a wide window truncated workspace names
          to "W…" with half the header empty beside them — a cap is a guess about
          how much room there is, and the browser already knows. `minWidth: 0` +
          `overflow: hidden` keep the squeeze graceful when the room really does
          run out: the chips ellipsize first (each carries its own `minWidth: 0`)
          and the row clips last, rather than running under SHARE. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 auto", minWidth: 0, overflow: "hidden" }}>
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
        {/* Two jobs, one control (ADR 0044 amended). The NAME opens the whole
            project — the frequent move, so it is a direct click — and the caret
            opens the project switcher, which is rare. They were one button when
            the header also carried an "All files" chip; that chip said the same
            thing as the project name sitting right beside it, so it went and its
            job came here. Split, not a menu item: burying "show me everything"
            one level down would make leaving a Workspace harder than entering
            one. Outside a project (`onProjectScope` absent) the whole control is
            the switcher, exactly as before. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 30,
            background: "var(--bg-sf)",
            border: `1px solid ${onProjectScope && projectScopeActive ? "var(--bdh)" : "var(--bd)"}`,
            borderRadius: 2,
            // Does NOT shrink. It used to, and the chip row beside it would
            // squeeze the project name to nothing on a narrow window — which was
            // survivable while this was just a switcher label and is not now
            // that it is how you leave a Workspace. The chips absorb the squeeze
            // instead: they ellipsize and fold into their own "+N" overflow.
            flex: "0 0 auto",
            maxWidth: 260,
          }}
        >
          <button
            onClick={onProjectScope ?? onOpenProj}
            title={onProjectScope ? `${projLabel} — all files in this project` : projLabel}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: "100%",
              padding: "0 9px",
              // The selected-scope tint, the same one the chips use. Only when
              // the name is a scope at all: outside a project it is a label on
              // the switcher and must not read as a state.
              background: onProjectScope && projectScopeActive ? "var(--bg-el)" : "transparent",
              border: 0,
              borderRadius: 0,
              color: "var(--t1)",
              fontSize: 13,
              fontWeight: 400,
              fontFamily: "inherit",
              cursor: "pointer",
              minWidth: 0,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, flex: "0 0 auto" }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} style={{ width: 5, height: 5, borderRadius: 1, background: "currentColor", opacity: 0.7 }} />
              ))}
            </div>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projLabel}</span>
            {!onProjectScope && (
              <ChevronDownIcon width={11} height={11} stroke="var(--t3)" style={{ flex: "0 0 auto" }} />
            )}
          </button>
          {onProjectScope && (
            <button
              onClick={onOpenProj}
              aria-label="Switch project"
              title="Switch project"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                width: 24,
                flex: "0 0 auto",
                padding: 0,
                background: "transparent",
                border: 0,
                borderLeft: "1px solid var(--bd)",
                borderRadius: 0,
                cursor: "pointer",
              }}
            >
              <ChevronDownIcon width={11} height={11} stroke="var(--t3)" />
            </button>
          )}
        </div>
        {afterProject && (
          <>
            <ChevronRightIcon width={12} height={12} stroke="var(--t3)" style={{ flex: "0 0 auto", opacity: 0.6 }} />
            {afterProject}
          </>
        )}
      </div>

      {/* Never shrinks: undo/redo, zoom, SHARE and the avatar are fixed chrome,
          so the breadcrumb on the left is what gives way when space is tight. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        {workspaceActions}
        {workspaceActions && <span style={{ width: 1, height: 20, background: "var(--bd)" }} />}
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
          title={accountName}
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
          {accountInitials}
        </button>
      </div>
    </div>
  );
}
