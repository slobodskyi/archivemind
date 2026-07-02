import { SelectToolIcon, HandToolIcon, AddIcon, FitIcon } from "@/components/icons/icons";

interface BottomToolbarProps {
  tool?: "select" | "hand";
  showCanvasTools?: boolean;
  showAddToProject?: boolean;
  selCount?: number;
  zoomPct?: string;
  onSelectTool?: () => void;
  onHandTool?: () => void;
  onAdd?: () => void;
  onFit?: () => void;
  onZoomReset?: () => void;
  onAddToProject?: () => void;
}

function Divider() {
  return <span style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 3px" }} />;
}

export default function BottomToolbar({
  tool = "select",
  showCanvasTools = true,
  showAddToProject = false,
  selCount = 0,
  zoomPct = "100%",
  onSelectTool,
  onHandTool,
  onAdd,
  onFit,
  onZoomReset,
  onAddToProject,
}: BottomToolbarProps) {
  const selBg = tool === "select" ? "#fff" : "transparent";
  const selColor = tool === "select" ? "#000" : "var(--t2)";
  const handBg = tool === "hand" ? "#fff" : "transparent";
  const handColor = tool === "hand" ? "#000" : "var(--t2)";

  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: 46,
        padding: "0 7px",
        background: "rgba(20,20,20,.92)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        zIndex: 35,
      }}
    >
      {showCanvasTools && (
        <>
          <button
            onClick={onSelectTool}
            className="am-tb"
            title="Select"
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
          </button>
          <button
            onClick={onHandTool}
            className="am-tb"
            title="Pan"
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
          </button>
          <Divider />
        </>
      )}

      <button
        onClick={onAdd}
        title="Add"
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
      </button>

      {showCanvasTools && (
        <>
          <Divider />
          <button
            onClick={onFit}
            title="Fit"
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
          </button>
          <button
            onClick={onZoomReset}
            style={{
              display: "flex",
              height: 34,
              padding: "0 9px",
              alignItems: "center",
              justifyContent: "center",
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              background: "transparent",
              color: "var(--t3)",
              fontSize: 12,
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
              alignItems: "center",
              gap: 7,
              height: 34,
              padding: "0 14px",
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              background: "var(--ac)",
              color: "#050505",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              fontFamily: "inherit",
            }}
          >
            <AddIcon width={14} height={14} />
            ADD {selCount} TO PROJECT
          </button>
        </>
      )}
    </div>
  );
}
