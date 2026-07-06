import { SelectToolIcon, HandToolIcon, AddIcon, FitIcon } from "@/components/icons/icons";

interface BottomToolbarProps {
  tool?: "select" | "hand";
  zoomPct?: string;
  onSelectTool?: () => void;
  onHandTool?: () => void;
  onAdd?: () => void;
  onFit?: () => void;
  onZoomReset?: () => void;
}

function Divider() {
  return <span style={{ width: 1, height: 22, background: "var(--border-subtle)", margin: "0 4px" }} />;
}

export default function BottomToolbar({
  tool = "select",
  zoomPct = "100%",
  onSelectTool,
  onHandTool,
  onAdd,
  onFit,
  onZoomReset,
}: BottomToolbarProps) {
  const selBg = tool === "select" ? "#fff" : "transparent";
  const selColor = tool === "select" ? "#000" : "var(--text-secondary)";
  const handBg = tool === "hand" ? "#fff" : "transparent";
  const handColor = tool === "hand" ? "#000" : "var(--text-secondary)";

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
        height: 48,
        padding: "0 8px",
        background: "rgba(26,26,26,0.9)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 999,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        zIndex: 35,
      }}
    >
      <button
        onClick={onSelectTool}
        className="am-tb"
        title="Select"
        aria-label="Select tool"
        style={{
          display: "flex",
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 999,
          cursor: "pointer",
          background: selBg,
          color: selColor,
        }}
      >
        <SelectToolIcon width={17} height={17} />
      </button>
      <button
        onClick={onHandTool}
        className="am-tb"
        title="Pan"
        aria-label="Pan tool"
        style={{
          display: "flex",
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 999,
          cursor: "pointer",
          background: handBg,
          color: handColor,
        }}
      >
        <HandToolIcon width={18} height={18} />
      </button>
      <Divider />

      <button
        onClick={onAdd}
        title="Add image"
        aria-label="Add image"
        style={{
          display: "flex",
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 999,
          cursor: "pointer",
          background: "transparent",
          color: "var(--text-secondary)",
        }}
      >
        <AddIcon width={18} height={18} />
      </button>
      <Divider />

      <button
        onClick={onFit}
        title="Fit to view"
        aria-label="Fit to view"
        style={{
          display: "flex",
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 999,
          cursor: "pointer",
          background: "transparent",
          color: "var(--text-secondary)",
        }}
      >
        <FitIcon width={17} height={17} />
      </button>
      <button
        onClick={onZoomReset}
        title="Reset zoom"
        style={{
          display: "flex",
          height: 36,
          padding: "0 10px",
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 999,
          cursor: "pointer",
          background: "transparent",
          color: "var(--text-tertiary)",
          fontSize: 12,
          fontFamily: "inherit",
        }}
      >
        {zoomPct}
      </button>
    </div>
  );
}
