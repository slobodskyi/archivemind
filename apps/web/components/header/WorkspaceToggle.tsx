import { ViewCanvasIcon } from "@/components/icons/icons";

interface WorkspaceToggleProps {
  active: boolean;
  onSelect: () => void;
}

/** The Workspace (neural view) entry point. Deliberately styled unlike the flat
 *  sorting tabs (Timeline/Map/Topic): it's the one place you actually work with
 *  files, so it reads as a solid primary control, not a peer in a segmented set.
 *  Lives in the subheader beneath AppHeader. */
export default function WorkspaceToggle({ active, onSelect }: WorkspaceToggleProps) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        height: 28,
        padding: "0 14px",
        border: active ? "1px solid var(--ac)" : "1px solid var(--bdh)",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: "0.04em",
        fontFamily: "inherit",
        cursor: "pointer",
        background: active ? "var(--ac)" : "transparent",
        color: active ? "#050505" : "var(--t1)",
        transition: "background .15s ease, color .15s ease, border-color .15s ease",
      }}
    >
      <ViewCanvasIcon width={14} height={14} />
      <span>Workspace</span>
    </button>
  );
}
