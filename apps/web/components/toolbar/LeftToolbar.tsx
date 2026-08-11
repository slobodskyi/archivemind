import { memo } from "react";
import type { Tool } from "@/types";
import {
  SelectToolIcon,
  HandToolIcon,
  AiAssistantIcon,
  AddIcon,
  FitIcon,
} from "@/components/icons/icons";

interface LeftToolbarProps {
  tool?: Tool;
  /** The legacy workspace recovery grid only selects/adds existing assets.
   * Editing, AI actions, and imports live inside an open project. */
  allFilesMode?: boolean;
  /** Map is a separate MapLibre surface — Fit/zoom would move the hidden canvas
   * underneath it, so those tools are hidden on Map. */
  isMapView?: boolean;
  showAddToProject?: boolean;
  selCount?: number;
  zoomPct?: string;
  /** AI assistant panel open? (the single AI-assistant/search entry point). */
  searchOpen?: boolean;
  onSelectTool?: () => void;
  onHandTool?: () => void;
  /** Toggle the AI assistant panel (search + help — see ChatPanel). */
  onOpenSearch?: () => void;
  onAdd?: () => void;
  onFit?: () => void;
  onZoomReset?: () => void;
  onAddToProject?: () => void;
}

function Divider() {
  return <span style={{ width: 20, height: 1, background: "var(--bd)", margin: "3px 0" }} />;
}

interface TbButtonProps {
  onClick?: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}

function TbButton({ onClick, title, active, children }: TbButtonProps) {
  return (
    <button
      onClick={onClick}
      className="am-tb tw"
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
        color: active ? "var(--ac)" : "var(--t2)",
      }}
    >
      {children}
      <span className="tip">{title}</span>
    </button>
  );
}

function LeftToolbar({
  tool = "select",
  allFilesMode = false,
  isMapView = false,
  showAddToProject = false,
  selCount = 0,
  zoomPct = "100%",
  searchOpen = false,
  onSelectTool,
  onHandTool,
  onOpenSearch,
  onAdd,
  onFit,
  onZoomReset,
  onAddToProject,
}: LeftToolbarProps) {
  const selBg = tool === "select" ? "#fff" : "transparent";
  const selColor = tool === "select" ? "#000" : "var(--t2)";
  const handBg = tool === "hand" ? "#fff" : "transparent";
  const handColor = tool === "hand" ? "#000" : "var(--t2)";

  return (
    <div
      style={{
        position: "absolute",
        left: 20,
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        width: 46,
        padding: "7px 0",
        background: "rgba(20,20,20,.92)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        zIndex: 35,
      }}
    >
      <button
        onClick={onSelectTool}
        className="am-tb tw"
        title="Select"
        aria-label="Select tool"
        style={{
          display: "flex",
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 2,
          cursor: "pointer",
          background: selBg,
          color: selColor,
        }}
      >
        <SelectToolIcon />
        <span className="tip">Select</span>
      </button>
      <button
        onClick={onHandTool}
        className="am-tb tw"
        title="Pan"
        aria-label="Pan tool"
        style={{
          display: "flex",
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 2,
          cursor: "pointer",
          background: handBg,
          color: handColor,
        }}
      >
        <HandToolIcon />
        <span className="tip">Pan</span>
      </button>
      <Divider />

      {/* AI actions, Trash and Extract EXIF moved off this rail: the first two
          duplicate the bottom action bar, and every file is analyzed on upload
          so EXIF extraction is no longer a manual step. */}
      <TbButton onClick={onOpenSearch} title="AI assistant" active={searchOpen}>
        <AiAssistantIcon />
      </TbButton>

      <Divider />

      {!allFilesMode && (
        <button
          onClick={onAdd}
          title="Add files"
          aria-label="Add files"
          className="tw"
          style={{
            display: "flex",
            width: 34,
            height: 34,
            alignItems: "center",
            justifyContent: "center",
            border: 0,
            borderRadius: 2,
            cursor: "pointer",
            background: "transparent",
            color: "var(--t2)",
          }}
        >
          <AddIcon />
          <span className="tip">Add files</span>
        </button>
      )}
      {/* Sticky notes are a Workspace tool now (Stage 2), not a sorting-view one,
          so the rail is identical on every sorting view. */}
      {/* Fit + zoom act on the tile canvas — on Map they'd move the hidden
          neural surface, so they're suppressed there (MapLibre has its own). */}
      {!isMapView && (
        <>
          <Divider />
          <button
            onClick={onFit}
            title="Fit"
            aria-label="Fit to content"
            className="tw"
            style={{
              display: "flex",
              width: 34,
              height: 34,
              alignItems: "center",
              justifyContent: "center",
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              background: "transparent",
              color: "var(--t2)",
            }}
          >
            <FitIcon />
            <span className="tip">Fit</span>
          </button>
          <button
            onClick={onZoomReset}
            style={{
              display: "flex",
              width: 34,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              background: "transparent",
              color: "var(--t3)",
              fontSize: 11,
              fontFamily: "inherit",
            }}
          >
            {zoomPct}
          </button>
        </>
      )}

      {showAddToProject && (
        <>
          <Divider />
          <button
            onClick={onAddToProject}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              width: 34,
              padding: "8px 2px",
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              background: "var(--ac)",
              color: "#050505",
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.02em",
              fontFamily: "inherit",
              lineHeight: 1.25,
              textAlign: "center",
            }}
          >
            <AddIcon width={14} height={14} />
            ADD {selCount}
          </button>
        </>
      )}
    </div>
  );
}

export default memo(LeftToolbar);
