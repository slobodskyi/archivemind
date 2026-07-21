import { ViewCanvasIcon } from "@/components/icons/icons";

interface WorkspaceToggleProps {
  active: boolean;
  onSelect: () => void;
}

/** The Workspace (neural view) entry point, sitting in the header breadcrumb
 *  right of the project name. Deliberately styled unlike the flat sorting tabs
 *  (Timeline/Map/Topic): it's the one place you actually work with files, so it
 *  reads as a solid control — filled green when active — not a peer tab. */
export default function WorkspaceToggle({ active, onSelect }: WorkspaceToggleProps) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 12px",
        border: active ? "1px solid var(--ac)" : "1px solid var(--bd)",
        borderRadius: 2,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.03em",
        fontFamily: "inherit",
        cursor: "pointer",
        flex: "0 0 auto",
        background: active ? "var(--ac)" : "transparent",
        color: active ? "#050505" : "var(--t2)",
        transition: "background .15s ease, color .15s ease, border-color .15s ease",
      }}
    >
      <ViewCanvasIcon width={13} height={13} />
      <span>Workspace</span>
    </button>
  );
}
