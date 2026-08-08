import { memo } from "react";
import type { Tool } from "@/types";
import {
  SelectToolIcon,
  HandToolIcon,
  SearchIcon,
  TagIcon,
  ExifIcon,
  AddIcon,
  FitIcon,
  LabelsIcon,
  StickyNoteIcon,
  TrashIcon,
} from "@/components/icons/icons";

interface LeftToolbarProps {
  tool?: Tool;
  /** The legacy workspace recovery grid only selects/adds existing assets.
   * Editing, AI actions, and imports live inside an open project. */
  allFilesMode?: boolean;
  /** Map is a separate MapLibre surface — Fit/zoom would move the hidden canvas
   * underneath it, so those tools are hidden on Map. */
  isMapView?: boolean;
  /** The Workspace (neural) view is showing. A sticky note's position is in
   * Workspace coordinates, so it is only offered — and only drawn — there;
   * every sorting view arranges the same tiles differently and a note pinned
   * over one arrangement means nothing over another. Same rule the artboard
   * and folder overlays already follow in ArchiveWorkspace. */
  isCanvasView?: boolean;
  showAddToProject?: boolean;
  selCount?: number;
  zoomPct?: string;
  /** Smart Search panel open? (the magnifier is the single search entry point). */
  searchOpen?: boolean;
  bulkPanelOpen?: boolean;
  onSelectTool?: () => void;
  onHandTool?: () => void;
  /** Toggle the Smart Search panel (the real search — see ChatPanel). */
  onOpenSearch?: () => void;
  onToggleBulkPanel?: () => void;
  onExtractExif?: () => void;
  onAdd?: () => void;
  onAddStickyNote?: () => void;
  onToggleTrash?: () => void;
  trashOpen?: boolean;
  /** Colour-label filter (migration 20260808000001). Lives on the tool rail
   *  rather than in the header: it is a lens on the canvas, like Search, and
   *  the header's three slots are navigation, view and account. */
  onToggleLabels?: () => void;
  labelsOpen?: boolean;
  /** A filter is active — the button stays lit even when the panel is closed,
   *  so a canvas that is hiding files can never look like an empty one. */
  labelFilterActive?: boolean;
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
  isCanvasView = true,
  showAddToProject = false,
  selCount = 0,
  zoomPct = "100%",
  searchOpen = false,
  bulkPanelOpen = false,
  onSelectTool,
  onHandTool,
  onOpenSearch,
  onToggleBulkPanel,
  onExtractExif,
  onAdd,
  onAddStickyNote,
  onToggleTrash,
  trashOpen = false,
  onToggleLabels,
  labelsOpen = false,
  labelFilterActive = false,
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

      <TbButton onClick={onOpenSearch} title="Smart Search" active={searchOpen}>
        <SearchIcon />
      </TbButton>
      <TbButton
        onClick={onToggleLabels}
        title={labelFilterActive ? "Labels — filter is on" : "Labels"}
        active={labelsOpen || labelFilterActive}
      >
        <LabelsIcon width={16} height={16} />
      </TbButton>
      <TbButton onClick={onToggleTrash} title="Trash" active={trashOpen}>
        <TrashIcon />
      </TbButton>
      {!allFilesMode && (
        <>
          {/* Was "Generate Captions", which named one of the two operations in
              the panel it opens — and not the one the panel actually ran. */}
          <TbButton onClick={onToggleBulkPanel} title="AI actions" active={bulkPanelOpen}>
            <TagIcon />
          </TbButton>
          <TbButton onClick={onExtractExif} title="Extract EXIF">
            <ExifIcon />
          </TbButton>
        </>
      )}

      <Divider />

      {!allFilesMode && (
        <button
          onClick={onAdd}
          title="Add"
          aria-label="Add"
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
          <span className="tip">Add</span>
        </button>
      )}
      {!allFilesMode && isCanvasView && (
        <button
          onClick={onAddStickyNote}
          title="Sticky Note"
          aria-label="Add sticky note"
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
          <StickyNoteIcon />
          <span className="tip">Sticky Note</span>
        </button>
      )}

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
